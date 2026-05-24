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

interface TimedActivity {
  activity: AgentActivity
  at: number
}

interface UseSessionEventsOptions {
  onApprovalRequest?: (request: ApprovalRequest | null) => void
  onDiffProposals?: (proposals: DiffProposal[]) => void
  onStatusChange?: (status: SessionStatus) => void
}

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
    const seen = new Set<string>()
    const append = (event: AgentEvent) => {
      const key = eventKey(event)
      if (seen.has(key)) return
      seen.add(key)
      applySessionState(event, optionsRef.current)
      setEvents((current) => [...current, event])
    }

    setLoading(true)
    const unsubscribe = window.agentforge.on(`session:${sessionId}`, append)

    void window.agentforge.sessions
      .listEvents(sessionId)
      .then((loadedEvents) => {
        if (cancelled) return
        loadedEvents.filter(shouldReplayHistoricalSessionEvent).forEach(append)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [sessionId])

  const timedActivities = useMemo(
    () => timedActivitiesFromEvents(events),
    [events],
  )
  const activities = useMemo(
    () => timedActivities.map(({ activity }) => activity),
    [timedActivities],
  )
  const activityTimes = useMemo(
    () => timedActivities.map(({ at }) => at),
    [timedActivities],
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
    for (let i = activities.length - 1; i >= 0; i -= 1) {
      const activity = activities[i]
      if (activity.kind !== 'plan-prompt') continue
      if (resolvedPromptIdsRef.current.has(activity.promptId)) continue
      return activity
    }
    return null
    // resolvedPromptVersion is part of the dependency list so the memo
    // refreshes when the resolved set mutates.
  }, [activities, resolvedPromptVersion])

  const pendingUserQuestion = useMemo<UserQuestionActivity | null>(() => {
    // Search from the end so the latest unresolved agent question wins.
    for (let i = activities.length - 1; i >= 0; i -= 1) {
      const activity = activities[i]
      if (activity.kind !== 'user-question') continue
      if (resolvedUserQuestionIdsRef.current.has(activity.promptId)) continue
      return activity
    }
    return null
  }, [activities, resolvedPromptVersion])

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
  return timedActivitiesFromEvents(events).map(({ activity }) => activity)
}

export function shouldReplayHistoricalSessionEvent(event: AgentEvent): boolean {
  return !(event.type === 'diff' && isLiveDiffPayload(event.payload))
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
    if (userQuestionFromActivity(event.payload) || event.payload.kind === 'model-recovery') {
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
