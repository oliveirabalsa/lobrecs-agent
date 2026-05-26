import { createHash } from 'node:crypto'
import type { AgentActivity, AgentEvent, SessionStatus } from '../../../../shared/types'
import { sessionsStore } from '../../../store'
import type { DelegateTaskRunner } from '../../../session/SessionManager'
import type { DelegatedTaskRecord } from './sessionWorkflowTypes'
import { completionStatus, textFromUnknownPayload } from './sessionWorkflowUtils'

export type SessionRecoveryDelegationServiceOptions = {
  delegatedTasksByChildSession: Map<string, DelegatedTaskRecord>
  processedDelegationRequests: Set<string>
  getDelegateTaskRunner(): DelegateTaskRunner | undefined
  getThreadId(sessionId: string): string | undefined
  recordEvent(event: AgentEvent): void
}

export type DelegatedTaskTerminalResult = {
  record: DelegatedTaskRecord
  status: Extract<AgentActivity, { kind: 'delegation' }>['status']
}

export class SessionRecoveryDelegationService {
  constructor(private readonly options: SessionRecoveryDelegationServiceOptions) {}

  maybeRunDelegateTask(activityEvent: AgentEvent): void {
    const delegateTaskRunner = this.options.getDelegateTaskRunner()
    if (!delegateTaskRunner) return
    if (!isDelegateTaskToolCall(activityEvent.payload)) return

    const session = sessionsStore.get(activityEvent.sessionId)
    const threadId = session?.threadId ?? this.options.getThreadId(activityEvent.sessionId)
    if (!session || !threadId) return
    if (session.spawnedAgent?.kind === 'delegation') return

    const request = delegateTaskRequestFromToolCall(activityEvent.payload)
    if (!request) return

    const requestKey = delegationRequestKey(activityEvent.sessionId, request)
    if (this.options.processedDelegationRequests.has(requestKey)) return
    this.options.processedDelegationRequests.add(requestKey)

    void delegateTaskRunner({
      parentSessionId: activityEvent.sessionId,
      projectId: session.projectId,
      threadId,
      goal: request.goal,
      context: request.context,
    }).catch((error) => {
      this.options.recordEvent({
        type: 'activity',
        sessionId: activityEvent.sessionId,
        payload: {
          kind: 'step',
          title: 'Delegated task failed to start',
          detail: error instanceof Error ? error.message : String(error),
          status: 'error',
        },
        timestamp: Date.now(),
      })
    })
  }

  registerDelegatedTask(record: DelegatedTaskRecord): void {
    this.options.delegatedTasksByChildSession.set(record.childSessionId, record)
    this.recordDelegationActivity(record, 'running')
  }

  mirrorDelegatedTaskEvent(event: AgentEvent): DelegatedTaskTerminalResult | null {
    const record = this.options.delegatedTasksByChildSession.get(event.sessionId)
    if (!record) return null

    const lastOutput = delegationOutputFromEvent(event)
    if (lastOutput) {
      record.lastOutput = truncateDelegationText(lastOutput, 500)
    }

    if (event.type === 'session-complete') {
      const status = delegationStatusFromSessionStatus(completionStatus(event))
      record.status = status
      record.summary = delegationSummary(record.childSessionId, event)
      this.recordDelegationActivity(record, status, {
        summary: record.summary,
      })
      this.options.delegatedTasksByChildSession.delete(event.sessionId)
      return { record, status }
    }

    if (event.type === 'error') {
      const error = textFromUnknownPayload(event.payload).trim()
      record.status = 'error'
      record.error = truncateDelegationText(error || 'Delegated task failed.', 500)
      record.summary = delegationSummary(record.childSessionId, event)
      this.recordDelegationActivity(record, 'error', {
        error: record.error,
        summary: record.summary,
      })
      this.options.delegatedTasksByChildSession.delete(event.sessionId)
      return { record, status: 'error' }
    }

    if (lastOutput || event.type === 'activity') {
      this.recordDelegationActivity(record, 'running')
    }

    return null
  }

  private recordDelegationActivity(
    record: DelegatedTaskRecord,
    status: Extract<AgentActivity, { kind: 'delegation' }>['status'],
    options: { summary?: string; error?: string } = {},
  ): void {
    this.options.recordEvent({
      type: 'activity',
      sessionId: record.parentSessionId,
      payload: {
        kind: 'delegation',
        delegationId: record.delegationId,
        childSessionId: record.childSessionId,
        childThreadId: record.childThreadId,
        goal: record.goal,
        status,
        agentId: record.agentId,
        model: record.model,
        lastOutput: record.lastOutput,
        summary: options.summary,
        error: options.error,
      },
      timestamp: Date.now(),
    })
  }
}

function isDelegateTaskToolCall(
  payload: unknown,
): payload is Extract<AgentActivity, { kind: 'tool-call' }> {
  if (!payload || typeof payload !== 'object') return false
  const activity = payload as Partial<Extract<AgentActivity, { kind: 'tool-call' }>>
  if (activity.kind !== 'tool-call') return false

  const normalized = activity.name?.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return normalized === 'delegatetask' || normalized === 'delegate'
}

function delegateTaskRequestFromToolCall(
  activity: Extract<AgentActivity, { kind: 'tool-call' }>,
): { goal: string; context?: string } | null {
  const input = structuredDelegationInput(activity.input)
  const goal =
    cleanDelegationString(input.goal) ??
    cleanDelegationString(input.task) ??
    cleanDelegationString(input.prompt)
  if (!goal) return null

  return {
    goal,
    context: cleanDelegationString(input.context),
  }
}

function structuredDelegationInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return { goal: input }
    }
  }

  return {}
}

function cleanDelegationString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function delegationRequestKey(
  sessionId: string,
  request: { goal: string; context?: string },
): string {
  return createHash('sha1')
    .update(sessionId)
    .update('\0')
    .update(request.goal)
    .update('\0')
    .update(request.context ?? '')
    .digest('hex')
}

function delegationOutputFromEvent(event: AgentEvent): string | null {
  if (event.type === 'stdout' || event.type === 'stderr') {
    const text = textFromUnknownPayload(event.payload).trim()
    return text || null
  }

  if (event.type !== 'activity') return null
  if (!event.payload || typeof event.payload !== 'object') return null

  const payload = event.payload as AgentActivity
  switch (payload.kind) {
    case 'message':
      return payload.text.trim() || null
    case 'tool-call':
      return `Running ${payload.name}`
    case 'tool-result':
      return payload.output?.trim() || `${payload.name} finished`
    case 'command':
      return payload.command
    case 'step':
      return payload.detail?.trim() || payload.title
    case 'completion':
      return payload.summary
    default:
      return null
  }
}

function delegationSummary(childSessionId: string, terminalEvent: AgentEvent): string | undefined {
  const events = [...sessionsStore.listEvents(childSessionId), terminalEvent]

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const output = delegationOutputFromEvent(events[index])
    if (output) return truncateDelegationText(output, 2_000)
  }

  const fallback = textFromUnknownPayload(terminalEvent.payload).trim()
  return fallback ? truncateDelegationText(fallback, 2_000) : undefined
}

function delegationStatusFromSessionStatus(
  status: SessionStatus,
): Extract<AgentActivity, { kind: 'delegation' }>['status'] {
  if (status === 'error' || status === 'cancelled') return status
  return 'done'
}

function truncateDelegationText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 3)}...`
}
