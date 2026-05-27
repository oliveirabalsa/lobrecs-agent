import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentActivity,
  AgentEvent,
  ApprovalRequest,
  DiffProposal,
  SessionStatus,
} from '../../../../shared/types'
import {
  completionStatus,
  eventKey,
  isLiveDiffPayload,
  normalizeApprovalPayload,
  normalizeDiffPayload,
  textFromPayload,
} from '../../../components/TerminalPanel/events'
import {
  isClaudeSessionEndHookWarning,
  processWarningKey,
} from '../../../../shared/contracts/agentOutput'
import {
  shouldSuppressUserQuestionToolResult,
  userQuestionActivityFromToolPayload,
} from '../../../../shared/contracts/userQuestionPrompts'

export type PlanPromptActivity = Extract<AgentActivity, { kind: 'plan-prompt' }>
export type UserQuestionActivity = Extract<AgentActivity, { kind: 'user-question' }>

export interface TimedActivity {
  activity: AgentActivity
  at: number
}

type AnimationFrameRequest = (callback: FrameRequestCallback) => number
type AnimationFrameCancel = (handle: number) => void
type TimeoutHandle = ReturnType<typeof setTimeout>

interface UseSessionEventsOptions {
  onApprovalRequest?: (request: ApprovalRequest | null) => void
  onDiffProposals?: (proposals: DiffProposal[]) => void
  onStatusChange?: (status: SessionStatus) => void
  /**
   * Maximum activities to derive for rendering.
   * When set, only the most recent `maxActivities` activities are returned
   * in the `activities` / `activityTimes` outputs, while full event history
   * is preserved in `events` for durability.
   * Defaults to 120 (approximately 10 turns of typical activity).
   */
  maxActivities?: number
}

interface CreateSessionEventBufferOptions {
  onFlush(events: AgentEvent[]): void
  flushDelayMs?: number
  requestAnimationFrame?: AnimationFrameRequest | null
  cancelAnimationFrame?: AnimationFrameCancel | null
  scheduleTimeout?: (callback: () => void, delay: number) => TimeoutHandle
  clearScheduledTimeout?: (handle: TimeoutHandle) => void
}

interface SessionEventBuffer {
  push(event: AgentEvent): void
  pushMany(events: readonly AgentEvent[]): void
  flush(): void
  dispose(): void
}

export const LIVE_EVENT_FLUSH_DELAY_MS = 40

export function useSessionEvents(sessionId: string | null, options: UseSessionEventsOptions = {}) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [loading, setLoading] = useState(false)
  const optionsRef = useRef(options)
  // Bumped whenever a promptId is resolved so the memoized derivation re-runs.
  const [resolvedPromptVersion, setResolvedPromptVersion] = useState(0)
  // Resolved set lives in a ref so updates don't cause a render of their own —
  // the version bump above is what triggers the recompute when needed.
  const resolvedPromptIdsRef = useRef<Set<string>>(new Set())
  const resolvedUserQuestionIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  // Reset the resolved set when switching sessions.
  useEffect(() => {
    resolvedPromptIdsRef.current = new Set()
    resolvedUserQuestionIdsRef.current = new Set()
    setResolvedPromptVersion((v) => v + 1)
  }, [sessionId])

  useEffect(() => {
    setEvents([])
    if (!sessionId) {
      setLoading(false)
      return
    }

    let cancelled = false
    const buffer = createSessionEventBuffer({
      onFlush: (batchedEvents) => {
        batchedEvents.forEach((event) => applySessionState(event, optionsRef.current))
        setEvents((current) => current.concat(batchedEvents))
      },
    })
    const append = (event: AgentEvent) => {
      buffer.push(event)
    }

    setLoading(true)
    const unsubscribe = window.agentforge.on(`session:${sessionId}`, append)

    void window.agentforge.sessions
      .listEvents(sessionId)
      .then((loadedEvents) => {
        if (cancelled) return
        const liveDiffProposals = latestHistoricalLiveDiffProposals(loadedEvents)
        if (liveDiffProposals.length > 0) {
          optionsRef.current.onDiffProposals?.(liveDiffProposals)
        }
        buffer.pushMany(loadedEvents.filter(shouldReplayHistoricalSessionEvent))
        buffer.flush()
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      unsubscribe()
      buffer.dispose()
    }
  }, [sessionId])

  const maxActivities = options.maxActivities ?? 120

  const timedActivities = useMemo(
    () => timedActivitiesFromEvents(events),
    [events],
  )

  const boundedTimedActivities = useMemo(() => {
    if (timedActivities.length <= maxActivities) return timedActivities
    return timedActivities.slice(timedActivities.length - maxActivities)
  }, [timedActivities, maxActivities])

  const activities = useMemo(
    () => boundedTimedActivities.map(({ activity }) => activity),
    [boundedTimedActivities],
  )
  const activityTimes = useMemo(
    () => boundedTimedActivities.map(({ at }) => at),
    [boundedTimedActivities],
  )
  const tokensIn = useMemo<number | null>(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i]
      if (event.type !== 'session-complete') continue
      const value = tokensInFromPayload(event.payload)
      if (value !== null) return value
    }
    return null
  }, [events])

  const pendingPlanPrompt = useMemo<PlanPromptActivity | null>(() => {
    // Search from the end so the latest unresolved prompt wins.
    // Use full timedActivities to find prompts even outside the bounded window.
    for (let i = timedActivities.length - 1; i >= 0; i -= 1) {
      const activity = timedActivities[i].activity
      if (activity.kind !== 'plan-prompt') continue
      if (resolvedPromptIdsRef.current.has(activity.promptId)) continue
      return activity
    }
    return null
    // resolvedPromptVersion is part of the dependency list so the memo
    // refreshes when the resolved set mutates.
  }, [timedActivities, resolvedPromptVersion])

  const pendingUserQuestion = useMemo<UserQuestionActivity | null>(() => {
    // Search from the end so the latest unresolved agent question wins.
    // Use full timedActivities to find questions even outside the bounded window.
    for (let i = timedActivities.length - 1; i >= 0; i -= 1) {
      const activity = timedActivities[i].activity
      if (activity.kind !== 'user-question') continue
      if (resolvedUserQuestionIdsRef.current.has(activity.promptId)) continue
      return activity
    }
    return null
  }, [timedActivities, resolvedPromptVersion])

  const resolvePlanPrompt = useCallback((promptId: string) => {
    if (resolvedPromptIdsRef.current.has(promptId)) return
    resolvedPromptIdsRef.current.add(promptId)
    setResolvedPromptVersion((v) => v + 1)
  }, [])

  const resolveUserQuestion = useCallback((promptId: string) => {
    if (resolvedUserQuestionIdsRef.current.has(promptId)) return
    resolvedUserQuestionIdsRef.current.add(promptId)
    setResolvedPromptVersion((v) => v + 1)
  }, [])

  return {
    events,
    activities,
    activityTimes,
    loading,
    pendingPlanPrompt,
    pendingUserQuestion,
    resolvePlanPrompt,
    resolveUserQuestion,
    tokensIn,
  }
}

export function deriveSessionActivities(events: readonly AgentEvent[]): AgentActivity[] {
  return deriveTimedSessionActivities(events).map(({ activity }) => activity)
}

export function deriveTimedSessionActivities(
  events: readonly AgentEvent[],
): TimedActivity[] {
  return timedActivitiesFromEvents(events)
}

export function shouldReplayHistoricalSessionEvent(event: AgentEvent): boolean {
  return !(event.type === 'diff' && isLiveDiffPayload(event.payload))
}

export function latestHistoricalLiveDiffProposals(
  events: readonly AgentEvent[],
): DiffProposal[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== 'diff') continue

    if (!isLiveDiffPayload(event.payload)) return []

    return normalizeDiffPayload(event.payload)
  }

  return []
}

export function shouldFlushSessionEventImmediately(event: AgentEvent): boolean {
  if (
    event.type === 'approval-request' ||
    event.type === 'error' ||
    event.type === 'session-complete'
  ) {
    return true
  }

  return event.type === 'activity' && isAgentActivity(event.payload)
    ? userQuestionFromActivity(event.payload) !== null
    : false
}

export function createSessionEventBuffer(
  options: CreateSessionEventBufferOptions,
): SessionEventBuffer {
  const requestFrame =
    options.requestAnimationFrame ??
    (typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : null)
  const cancelFrame =
    options.cancelAnimationFrame ??
    (typeof globalThis.cancelAnimationFrame === 'function'
      ? globalThis.cancelAnimationFrame.bind(globalThis)
      : null)
  const scheduleTimeout = options.scheduleTimeout ?? ((callback, delay) => setTimeout(callback, delay))
  const clearScheduledTimeout = options.clearScheduledTimeout ?? clearTimeout
  const flushDelayMs = options.flushDelayMs ?? LIVE_EVENT_FLUSH_DELAY_MS

  const seenKeys = new Set<string>()
  let pending: AgentEvent[] = []
  let frameHandle: number | null = null
  let timeoutHandle: TimeoutHandle | null = null

  const clearScheduledFlush = () => {
    if (frameHandle !== null && cancelFrame) {
      cancelFrame(frameHandle)
    }
    if (timeoutHandle !== null) {
      clearScheduledTimeout(timeoutHandle)
    }

    frameHandle = null
    timeoutHandle = null
  }

  const flush = () => {
    clearScheduledFlush()
    if (pending.length === 0) return

    const next = pending
    pending = []
    options.onFlush(next)
  }

  const scheduleFlush = () => {
    if (frameHandle !== null || timeoutHandle !== null) return

    if (requestFrame) {
      frameHandle = requestFrame(() => {
        flush()
      })
    }

    timeoutHandle = scheduleTimeout(() => {
      flush()
    }, flushDelayMs)
  }

  const pushMany = (events: readonly AgentEvent[]) => {
    let didQueue = false
    let shouldFlushNow = false

    for (const event of events) {
      const key = eventKey(event)
      if (seenKeys.has(key)) continue

      seenKeys.add(key)
      pending.push(event)
      didQueue = true

      if (shouldFlushSessionEventImmediately(event)) {
        shouldFlushNow = true
      }
    }

    if (!didQueue) return
    if (shouldFlushNow) {
      flush()
      return
    }

    scheduleFlush()
  }

  return {
    push(event) {
      pushMany([event])
    },
    pushMany,
    flush,
    dispose() {
      clearScheduledFlush()
      pending = []
    },
  }
}

function timedActivitiesFromEvents(events: readonly AgentEvent[]): TimedActivity[] {
  const explicitProcessWarnings = collectExplicitProcessWarnings(events)
  const seenProcessWarnings = new Set<string>()
  const seenUserQuestionPromptIds = new Set<string>()

  return events.flatMap((event) =>
    timedActivitiesFromEvent(event, {
      explicitProcessWarnings,
      seenProcessWarnings,
      seenUserQuestionPromptIds,
    }),
  )
}

type ProcessWarningState = {
  explicitProcessWarnings: ReadonlySet<string>
  seenProcessWarnings: Set<string>
  seenUserQuestionPromptIds: Set<string>
}

function applySessionState(event: AgentEvent, options: UseSessionEventsOptions): void {
  if (event.type === 'activity' && isAgentActivity(event.payload)) {
    if (
      userQuestionFromActivity(event.payload) ||
      event.payload.kind === 'model-recovery' ||
      event.payload.kind === 'multitask-plan'
    ) {
      options.onStatusChange?.('awaiting-input')
    }
    return
  }

  if (event.type === 'approval-request') {
    options.onStatusChange?.('awaiting-approval')
    options.onApprovalRequest?.(normalizeApprovalPayload(event.payload))
    return
  }

  if (event.type === 'diff') {
    const proposals = normalizeDiffPayload(event.payload)
    if (proposals.length > 0) {
      options.onDiffProposals?.(proposals)
    }
    return
  }

  if (event.type === 'session-complete') {
    options.onStatusChange?.(completionStatus(event.payload))
    options.onApprovalRequest?.(null)
    return
  }

  if (event.type === 'error') {
    options.onStatusChange?.('error')
    options.onApprovalRequest?.(null)
  }
}

function activityFromEvent(
  event: AgentEvent,
  warningState: ProcessWarningState,
): AgentActivity[] {
  if (event.type === 'activity' && isAgentActivity(event.payload)) {
    const question = userQuestionFromActivity(event.payload)
    if (question) {
      if (warningState.seenUserQuestionPromptIds.has(question.promptId)) return []

      warningState.seenUserQuestionPromptIds.add(question.promptId)
      return [question]
    }

    if (shouldSuppressUserQuestionToolResultFromActivity(event.payload)) return []
    if (shouldSuppressProcessWarningActivity(event.payload, warningState)) return []

    return [event.payload]
  }

  if (event.type === 'stdout') return []

  if (event.type === 'stderr') {
    const text = textFromPayload(event.payload)
    const detail = text.trim()
    if (!detail) return []
    if (isClaudeSessionEndHookWarning(detail)) return []

    const key = processWarningKey(detail)
    if (warningState.explicitProcessWarnings.has(key)) return []
    if (warningState.seenProcessWarnings.has(key)) return []

    warningState.seenProcessWarnings.add(key)
    return [{ kind: 'step', title: 'Process warning', detail, status: 'error' }]
  }

  if (event.type === 'approval-request') {
    return [{ kind: 'step', title: 'Approval requested', status: 'pending' }]
  }

  if (event.type === 'diff') {
    if (isLiveDiffPayload(event.payload)) return []
    return [{ kind: 'step', title: 'Code changes applied', status: 'done' }]
  }

  if (event.type === 'session-complete') {
    const status = completionStatus(event.payload)
    return [
      {
        kind: 'completion',
        status,
        summary: status === 'error' ? 'Session failed' : 'Session complete',
      },
    ]
  }

  if (event.type === 'error') {
    const text = textFromPayload(event.payload, { fallbackToJson: true })
    return [
      {
        kind: 'step',
        title: 'Session failed',
        detail: text.trim(),
        status: 'error',
      },
    ]
  }

  return []
}

function timedActivitiesFromEvent(
  event: AgentEvent,
  warningState: ProcessWarningState,
): TimedActivity[] {
  return activityFromEvent(event, warningState).map((activity, index) => ({
    activity,
    at: event.timestamp + index,
  }))
}

function collectExplicitProcessWarnings(events: readonly AgentEvent[]): Set<string> {
  const warnings = new Set<string>()

  for (const event of events) {
    if (event.type !== 'activity' || !isAgentActivity(event.payload)) continue

    const key = processWarningActivityKey(event.payload)
    if (key) warnings.add(key)
  }

  return warnings
}

function userQuestionFromActivity(activity: AgentActivity): UserQuestionActivity | null {
  if (activity.kind === 'user-question') return activity
  if (activity.kind !== 'tool-call') return null

  return userQuestionActivityFromToolPayload(activity)
}

function shouldSuppressUserQuestionToolResultFromActivity(activity: AgentActivity): boolean {
  return (
    activity.kind === 'tool-result' &&
    shouldSuppressUserQuestionToolResult(activity.name, activity.output)
  )
}

function shouldSuppressProcessWarningActivity(
  activity: AgentActivity,
  warningState: ProcessWarningState,
): boolean {
  if (isClaudeProcessWarningActivity(activity)) return true

  const key = processWarningActivityKey(activity)
  if (!key) return false
  if (warningState.seenProcessWarnings.has(key)) return true

  warningState.seenProcessWarnings.add(key)
  return false
}

function processWarningActivityKey(activity: AgentActivity): string | null {
  if (activity.kind !== 'step') return null
  if (activity.title !== 'Process warning') return null
  if (!activity.detail) return null

  const key = processWarningKey(activity.detail)
  return key || null
}

function isClaudeProcessWarningActivity(activity: AgentActivity): boolean {
  return (
    activity.kind === 'step' &&
    activity.title === 'Process warning' &&
    typeof activity.detail === 'string' &&
    isClaudeSessionEndHookWarning(activity.detail)
  )
}

function isAgentActivity(payload: unknown): payload is AgentActivity {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'kind' in payload &&
    typeof (payload as { kind?: unknown }).kind === 'string'
  )
}

function tokensInFromPayload(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>

  if (p.usage && typeof p.usage === 'object') {
    const u = p.usage as Record<string, unknown>
    if (typeof u.input_tokens === 'number') return u.input_tokens
    if (typeof u.inputTokens === 'number') return u.inputTokens
  }

  if (typeof p.input_tokens === 'number') return p.input_tokens
  if (typeof p.tokensIn === 'number') return p.tokensIn
  if (typeof p.tokens_in === 'number') return p.tokens_in

  return null
}
