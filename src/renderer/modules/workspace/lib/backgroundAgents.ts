import type { AgentActivity, AgentEvent, Session } from '../../../../shared/types'
import type { SessionStatus } from '../../../../shared/types'
import { userQuestionActivityFromToolPayload } from '../../../../shared/contracts/userQuestionPrompts'

export type BackgroundAgentSession = Session & {
  spawnedAgent: NonNullable<Session['spawnedAgent']>
}

export const ACTIVE_BACKGROUND_AGENT_STATUSES = new Set<SessionStatus>([
  'running',
  'awaiting-approval',
])

export const STOPPABLE_BACKGROUND_AGENT_STATUSES = new Set<SessionStatus>([
  'running',
  'awaiting-approval',
  'awaiting-input',
])

export interface BackgroundAgentSummary {
  total: number
  done: number
  active: number
  failed: number
}

export interface BackgroundAgentUserQuestion {
  session: BackgroundAgentSession
  prompt: Extract<AgentActivity, { kind: 'user-question' }>
  key: string
}

export const BACKGROUND_AGENT_PREVIEW_LIMIT = 4

export interface BackgroundAgentPreviewState {
  visibleSessions: readonly BackgroundAgentSession[]
  hiddenCount: number
  overLimit: boolean
}

export function latestBackgroundAgentSessions(
  sessions: readonly Session[],
  threadId: string | null | undefined,
): BackgroundAgentSession[] {
  if (!threadId) return []

  const threadSessions = sessions
    .filter((session) => session.threadId === threadId)
    .sort((a, b) => a.createdAt - b.createdAt)

  let lastSpawnedIndex = -1
  for (let index = threadSessions.length - 1; index >= 0; index -= 1) {
    if (threadSessions[index].spawnedAgent) {
      lastSpawnedIndex = index
      break
    }
  }
  if (lastSpawnedIndex < 0) return []

  let firstSpawnedIndex = lastSpawnedIndex
  while (firstSpawnedIndex > 0 && threadSessions[firstSpawnedIndex - 1].spawnedAgent) {
    firstSpawnedIndex -= 1
  }

  return threadSessions
    .slice(firstSpawnedIndex, lastSpawnedIndex + 1)
    .filter((session): session is BackgroundAgentSession => Boolean(session.spawnedAgent))
}

export function summarizeBackgroundAgentSessions(
  sessions: readonly BackgroundAgentSession[],
): BackgroundAgentSummary {
  return {
    total: sessions.length,
    done: sessions.filter((session) => session.status === 'done').length,
    active: sessions.filter((session) => ACTIVE_BACKGROUND_AGENT_STATUSES.has(session.status)).length,
    failed: sessions.filter((session) => session.status === 'error' || session.status === 'cancelled')
      .length,
  }
}

export function backgroundAgentPreviewState(
  sessions: readonly BackgroundAgentSession[],
  showAll: boolean,
  limit = BACKGROUND_AGENT_PREVIEW_LIMIT,
): BackgroundAgentPreviewState {
  const hiddenCount = Math.max(0, sessions.length - limit)
  return {
    visibleSessions: showAll || hiddenCount === 0 ? sessions : sessions.slice(-limit),
    hiddenCount,
    overLimit: hiddenCount > 0,
  }
}

export function backgroundAgentWaitMessage(
  sessions: readonly BackgroundAgentSession[],
): string | null {
  const pending = sessions.filter((session) =>
    ACTIVE_BACKGROUND_AGENT_STATUSES.has(session.status),
  )
  if (sessions.length === 0 || pending.length === 0) return null

  const done = sessions.filter((session) => session.status === 'done')
  const doneText =
    done.length > 0
      ? `${formatAgentList(done)} done. `
      : ''

  return `${doneText}Waiting for ${formatAgentList(pending)}.`
}

export function latestBackgroundAgentUserQuestion(
  sessions: readonly BackgroundAgentSession[],
  eventsBySession: ReadonlyMap<string, readonly AgentEvent[]>,
): BackgroundAgentUserQuestion | null {
  for (let sessionIndex = sessions.length - 1; sessionIndex >= 0; sessionIndex -= 1) {
    const session = sessions[sessionIndex]
    if (session.status !== 'awaiting-input') continue
    const events = eventsBySession.get(session.id) ?? []

    for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
      const prompt = userQuestionFromEvent(events[eventIndex])
      if (!prompt) continue

      return {
        session,
        prompt,
        key: `${session.id}:${prompt.promptId}`,
      }
    }
  }

  return null
}

export function canStopBackgroundAgentSession(session: BackgroundAgentSession): boolean {
  return STOPPABLE_BACKGROUND_AGENT_STATUSES.has(session.status)
}

export function backgroundAgentStatusFromEvent(event: AgentEvent): SessionStatus | null {
  if (event.type === 'approval-request') return 'awaiting-approval'
  if (event.type === 'error') return 'error'
  if (event.type === 'activity' && userQuestionFromEvent(event)) return 'awaiting-input'
  if (event.type !== 'session-complete') return null

  const payload = event.payload
  if (payload && typeof payload === 'object') {
    const status = (payload as { status?: unknown }).status
    if (isSessionStatus(status)) return status
  }
  return 'done'
}

function formatAgentList(sessions: readonly BackgroundAgentSession[]): string {
  return sessions
    .map((session) => session.spawnedAgent.role.trim() || 'background agent')
    .join(', ')
    .replace(/, ([^,]*)$/, sessions.length > 1 ? ' and $1' : '$1')
}

function userQuestionFromEvent(
  event: AgentEvent,
): Extract<AgentActivity, { kind: 'user-question' }> | null {
  if (event.type !== 'activity') return null
  if (!event.payload || typeof event.payload !== 'object') return null

  const activity = event.payload as AgentActivity
  if (activity.kind === 'user-question') return activity
  if (activity.kind !== 'tool-call') return null

  return userQuestionActivityFromToolPayload(activity)
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return (
    value === 'running' ||
    value === 'awaiting-approval' ||
    value === 'awaiting-input' ||
    value === 'done' ||
    value === 'error' ||
    value === 'cancelled'
  )
}
