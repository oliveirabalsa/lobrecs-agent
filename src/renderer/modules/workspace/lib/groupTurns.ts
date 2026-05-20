import type { AgentActivity, ImageAttachment } from '../../../../shared/types'
import {
  shouldSuppressUserQuestionToolResult,
  userQuestionActivityFromToolPayload,
} from '../../../../shared/contracts/userQuestionPrompts'

/**
 * A "turn" groups one user message together with all the activities the
 * agent emitted in response to it, up to (and including) the next
 * `completion` event.
 *
 * The current `AgentActivity` union does NOT contain user-role messages —
 * user prompts live on `Session.prompt`. The first turn therefore optionally
 * carries a `seedUserMessage` (the originating session prompt) so the stream
 * has something to anchor the right-aligned bubble against.
 */
export type TurnStatus =
  | 'running'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'awaiting-approval'
  | 'awaiting-input'

export interface TurnUserMessage {
  text: string
  attachments?: ImageAttachment[]
  at?: number
}

/**
 * Renderer-only synthetic groups produced by the M4 aggregation pass.
 *
 * `ran-commands-group` collapses consecutive `command | tool-call | tool-result`
 * activities. `edited-files-group` collapses consecutive `file-change`
 * activities that arrived within `AGGREGATE_TIME_WINDOW_MS` of each other.
 *
 * These do NOT live in the shared contracts — they're a pure UI concern.
 */
export type StreamItem =
  | AgentActivity
  | {
      kind: 'ran-commands-group'
      id: string
      items: Array<Extract<AgentActivity, { kind: 'command' | 'tool-call' | 'tool-result' }>>
    }
  | {
      kind: 'edited-files-group'
      id: string
      items: Array<Extract<AgentActivity, { kind: 'file-change' }>>
    }

export interface Turn {
  id: string
  userMessage?: TurnUserMessage
  /** Raw activities, in arrival order (used internally + for debugging). */
  activities: AgentActivity[]
  /** Activities + synthetic groups, in render order. Produced by aggregation pass. */
  streamItems: StreamItem[]
  finalAssistantText?: string
  completion?: Extract<AgentActivity, { kind: 'completion' }>
  startedAt: number
  endedAt?: number
  status: TurnStatus
}

export interface GroupTurnsOptions {
  /** Origin user prompt that anchors the very first turn. */
  seedUserMessage?: TurnUserMessage
  /** Clock used for `startedAt`/`endedAt` synthesis (defaults to Date.now). */
  now?: number
  /**
   * Optional per-activity timestamps (ms) aligned by index with the
   * `activities` input. When omitted we fall back to `now + index`, which
   * means consecutive activities are effectively contiguous (always grouped).
   * Tests use this to exercise the file-change time-window split.
   */
  activityTimes?: number[]
}

const FILE_CHANGE_WINDOW_MS = 30_000

/**
 * Pure function — turns a flat activity stream into ordered Turn groups.
 *
 * Rules:
 *  - A turn extends from the start (or the activity after the last
 *    `completion`) up to and including the next `completion` event.
 *  - `compaction` activities are emitted as their own single-entry turns so
 *    the stream can drop a `<Divider />` between turns.
 *  - The first turn carries `seedUserMessage` if one was provided.
 *  - `finalAssistantText` is the text of the last `message` with role
 *    `assistant` seen inside the turn.
 *  - `status` reflects the turn's completion event when present, otherwise
 *    `'running'`.
 *
 * Aggregation pass (M4):
 *  - Consecutive `command | tool-call | tool-result` activities collapse
 *    into one `ran-commands-group` StreamItem.
 *  - Consecutive `file-change` activities within FILE_CHANGE_WINDOW_MS
 *    collapse into one `edited-files-group` StreamItem.
 *  - Singletons remain as the original activity.
 */
export function groupTurns(
  activities: AgentActivity[],
  options: GroupTurnsOptions = {},
): Turn[] {
  const now = options.now ?? Date.now()
  const times = options.activityTimes
  const turns: Turn[] = []

  let current: Turn | null = null
  let nextTurnIndex = 0
  let seedConsumed = false
  // Track timestamps for activities inside the current turn so the aggregation
  // pass can apply its time window.
  let currentTimes: number[] = []

  function timeOf(index: number): number {
    return times?.[index] ?? now + index
  }

  function ensureCurrent(startIndex: number): Turn {
    if (current) return current
    const seedForTurn = !seedConsumed ? options.seedUserMessage : undefined
    const turn: Turn = {
      id: `turn-${nextTurnIndex}`,
      userMessage: seedForTurn,
      activities: [],
      streamItems: [],
      startedAt: seedForTurn?.at ?? timeOf(startIndex),
      status: 'running',
    }
    seedConsumed = true
    nextTurnIndex += 1
    current = turn
    currentTimes = []
    return turn
  }

  function closeCurrent(): void {
    if (!current) return
    const normalized = normalizeAssistantTimeline(current.activities, currentTimes)
    current.activities = normalized.activities
    currentTimes = normalized.times
    current.streamItems = aggregateStreamItems(
      current.activities,
      currentTimes,
      current.id,
    )
    turns.push(current)
    current = null
    currentTimes = []
  }

  activities.forEach((activity, index) => {
    if (activity.kind === 'compaction') {
      closeCurrent()
      const t = activity.at ?? timeOf(index)
      turns.push({
        id: `turn-${nextTurnIndex}`,
        activities: [activity],
        streamItems: [activity],
        startedAt: t,
        endedAt: t,
        status: 'done',
      })
      nextTurnIndex += 1
      return
    }

    if (current?.completion && !isPostCompletionArtifact(activity)) {
      closeCurrent()
    }

    const turn = ensureCurrent(index)
    turn.activities.push(activity)
    currentTimes.push(timeOf(index))

    if (activity.kind === 'message' && activity.role === 'assistant') {
      turn.finalAssistantText = activity.text
    }

    if (activity.kind === 'completion') {
      turn.completion = activity
      turn.status = mapCompletionStatus(activity.status)
      turn.endedAt = timeOf(index)
    }
  })

  closeCurrent()

  if (turns.length === 0 && options.seedUserMessage) {
    turns.push({
      id: `turn-${nextTurnIndex}`,
      userMessage: options.seedUserMessage,
      activities: [],
      streamItems: [],
      startedAt: options.seedUserMessage.at ?? now,
      status: 'running',
    })
  }

  return turns
}

function aggregateStreamItems(
  activities: AgentActivity[],
  times: number[],
  turnId: string,
): StreamItem[] {
  const items: StreamItem[] = []
  let i = 0
  let groupCounter = 0
  const seenUserQuestionPromptIds = new Set<string>()
  while (i < activities.length) {
    const activity = activities[i]
    const userQuestion = userQuestionStreamItem(activity)
    if (userQuestion) {
      if (!seenUserQuestionPromptIds.has(userQuestion.promptId)) {
        seenUserQuestionPromptIds.add(userQuestion.promptId)
        items.push(userQuestion)
      }
      i += 1
      continue
    }

    if (shouldSuppressUserQuestionToolResultActivity(activity)) {
      i += 1
      continue
    }

    // Consecutive command/tool-call/tool-result → ran-commands-group
    if (isCommandLike(activity)) {
      const batch: Array<Extract<AgentActivity, { kind: 'command' | 'tool-call' | 'tool-result' }>> = []
      let j = i
      while (j < activities.length && isCommandLike(activities[j])) {
        batch.push(
          activities[j] as Extract<
            AgentActivity,
            { kind: 'command' | 'tool-call' | 'tool-result' }
          >,
        )
        j += 1
      }
      if (batch.length === 1) {
        items.push(batch[0])
      } else {
        groupCounter += 1
        items.push({
          kind: 'ran-commands-group',
          id: `${turnId}-ran-${groupCounter}`,
          items: batch,
        })
      }
      i = j
      continue
    }

    // Consecutive file-change within 30s window → edited-files-group
    if (activity.kind === 'file-change') {
      const batch: Array<Extract<AgentActivity, { kind: 'file-change' }>> = [activity]
      let lastTime = times[i] ?? 0
      let j = i + 1
      while (j < activities.length && activities[j].kind === 'file-change') {
        const t = times[j] ?? 0
        if (t - lastTime > FILE_CHANGE_WINDOW_MS) break
        batch.push(activities[j] as Extract<AgentActivity, { kind: 'file-change' }>)
        lastTime = t
        j += 1
      }
      if (batch.length === 1) {
        items.push(batch[0])
      } else {
        groupCounter += 1
        items.push({
          kind: 'edited-files-group',
          id: `${turnId}-edits-${groupCounter}`,
          items: batch,
        })
      }
      i = j
      continue
    }

    items.push(activity)
    i += 1
  }
  return items
}

export function normalizeAssistantMessages(activities: AgentActivity[]): AgentActivity[] {
  return normalizeAssistantTimeline(activities, []).activities
}

function normalizeAssistantTimeline(
  activities: AgentActivity[],
  times: number[],
): { activities: AgentActivity[]; times: number[] } {
  const normalized: AgentActivity[] = []
  const normalizedTimes: number[] = []
  let pendingStreamText = ''
  let pendingStreamTime: number | undefined
  // Track every normalized assistant text emitted this turn so that
  // re-emissions (e.g. Codex item.completed after streaming deltas) are
  // suppressed even when an intermediate activity reset "last seen".
  const seenAssistantTexts = new Set<string>()

  const flushPendingStream = () => {
    if (!pendingStreamText.trim()) {
      pendingStreamText = ''
      pendingStreamTime = undefined
      return
    }

    const text = pendingStreamText
    const at = pendingStreamTime
    pendingStreamText = ''
    pendingStreamTime = undefined
    const key = normalizeAssistantText(text)
    if (seenAssistantTexts.has(key)) return

    seenAssistantTexts.add(key)
    normalized.push({ kind: 'message', role: 'assistant', text, stream: true })
    if (at !== undefined) normalizedTimes.push(at)
  }

  activities.forEach((activity, index) => {
    if (activity.kind === 'message' && activity.role === 'assistant') {
      if (activity.stream) {
        pendingStreamTime ??= times[index]
        pendingStreamText = mergeAssistantStreamText(pendingStreamText, activity.text)
        return
      }

      flushPendingStream()
      const key = normalizeAssistantText(activity.text)
      if (seenAssistantTexts.has(key)) return

      seenAssistantTexts.add(key)
      normalized.push(activity)
      if (times[index] !== undefined) normalizedTimes.push(times[index])
      return
    }

    flushPendingStream()
    normalized.push(activity)
    if (times[index] !== undefined) normalizedTimes.push(times[index])
  })

  flushPendingStream()
  return { activities: normalized, times: normalizedTimes }
}

function normalizeAssistantText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function mergeAssistantStreamText(current: string, incoming: string): string {
  if (!incoming.trim()) return current
  if (!current) return incoming

  const currentKey = normalizeAssistantText(current)
  const incomingKey = normalizeAssistantText(incoming)
  if (!incomingKey || incomingKey === currentKey) return current

  if (incoming.startsWith(current)) return incoming
  if (current.endsWith(incoming)) return current

  if (currentKey.length >= 12 && incomingKey.startsWith(currentKey)) return incoming
  if (incomingKey.length >= 12 && currentKey.endsWith(incomingKey)) return current

  return current + incoming
}

function isCommandLike(activity: AgentActivity): boolean {
  return (
    activity.kind === 'command' ||
    activity.kind === 'tool-call' ||
    activity.kind === 'tool-result'
  )
}

function userQuestionStreamItem(
  activity: AgentActivity,
): Extract<AgentActivity, { kind: 'user-question' }> | null {
  if (activity.kind === 'user-question') return activity
  if (activity.kind !== 'tool-call') return null

  return userQuestionActivityFromToolPayload(activity)
}

function shouldSuppressUserQuestionToolResultActivity(activity: AgentActivity): boolean {
  return (
    activity.kind === 'tool-result' &&
    shouldSuppressUserQuestionToolResult(activity.name, activity.output)
  )
}

function isPostCompletionArtifact(activity: AgentActivity): boolean {
  return (
    activity.kind === 'step' ||
    activity.kind === 'approval' ||
    activity.kind === 'diff-summary' ||
    activity.kind === 'file-change'
  )
}

function mapCompletionStatus(
  status: Extract<AgentActivity, { kind: 'completion' }>['status'],
): TurnStatus {
  switch (status) {
    case 'running':
      return 'running'
    case 'awaiting-approval':
      return 'awaiting-approval'
    case 'awaiting-input':
      return 'awaiting-input'
    case 'error':
      return 'error'
    case 'cancelled':
      return 'cancelled'
    case 'done':
    default:
      return 'done'
  }
}
