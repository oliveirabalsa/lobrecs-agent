import type { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import type {
  AgentActivity,
  AgentEvent,
  AgentId,
  AgentRuntimeSettings,
  QueuedMessage,
  QueueStatusEvent,
  ThreadTranscriptTurn,
  SessionStatus,
  Thread,
  ThreadUpdatedEvent,
} from '../../shared/types'
import { processWarningKey } from '../../shared/contracts/agentOutput'
import { worktreeManager } from '../git/WorktreeManager'
import { applyDiffContent } from '../modules/diffs/application/applyDiff'
import { sessionsStore, threadsStore } from '../store'
import { deriveActivityEvents } from './activity'
import {
  buildLocalDiffProposals,
  captureLocalChangeBaseline,
  type LocalChangeBaseline,
} from './localDiff'
import { buildDiffProposals } from './worktreeDiff'
import type { DiffProposal, ImageAttachment } from '../../shared/types'

const require = createRequire(import.meta.url)

export type AgentSession = {
  sessionId: string
  events: EventEmitter
  approve(): void
  reject(): void
  cancel(): void
}

export type AgentAdapter = {
  id: AgentId
  name?: string
  dispatch(params: {
    sessionId: string
    prompt: string
    repoPath: string
    model: string
    context?: string | null
    imageAttachments?: ImageAttachment[]
    runtimeSettings?: AgentRuntimeSettings
  }): Promise<AgentSession>
}

export type DispatchSessionParams = {
  projectId: string
  prompt: string
  agentId: AgentId
  model: string
  repoPath: string
  context?: string | null
  imageAttachments?: ImageAttachment[]
  runtimeSettings?: AgentRuntimeSettings
  isolate?: boolean
  /** When provided, links the new session to an existing thread. */
  threadId?: string
}

export type DispatchSessionResult = {
  sessionId: string
  threadId: string
}

export type EventBroadcaster = (event: AgentEvent) => void
export type CostEstimator = (model: string, tokensIn: number, tokensOut: number) => number
export type AdapterResolver = (agentId: AgentId) => AgentAdapter | undefined

type ActiveSession = Pick<AgentSession, 'approve' | 'reject' | 'cancel'> & {
  repoPath: string
  worktreePath: string | null
  localBaseline: LocalChangeBaseline | null
}

const terminalSessionStatuses = new Set<SessionStatus>(['done', 'error', 'cancelled'])
const THREAD_CONTEXT_SESSION_LIMIT = 6
const THREAD_CONTEXT_PROMPT_CHARS = 2_000
const THREAD_CONTEXT_ASSISTANT_CHARS = 4_000

export type SessionManagerOptions = {
  adapters?: Iterable<AgentAdapter>
  adapterResolver?: AdapterResolver
  broadcast?: EventBroadcaster
  estimateCost?: CostEstimator
  worktreeIsolation?: boolean
}

export class SessionManager {
  private readonly adapters = new Map<AgentId, AgentAdapter>()
  private readonly activeSessions = new Map<string, ActiveSession>()
  private readonly adapterResolver?: AdapterResolver
  private readonly broadcastEvent: EventBroadcaster
  private readonly worktreeIsolation: boolean
  private readonly processWarningsBySession = new Map<string, Set<string>>()
  private readonly sessionsPausedForUserInput = new Set<string>()
  private readonly pendingQueues = new Map<string, QueuedMessage[]>()
  private estimateCost: CostEstimator

  constructor(options: SessionManagerOptions = {}) {
    this.adapterResolver = options.adapterResolver
    this.broadcastEvent = options.broadcast ?? broadcastToRenderer
    this.worktreeIsolation = options.worktreeIsolation ?? false
    this.estimateCost = options.estimateCost ?? (() => 0)

    for (const adapter of options.adapters ?? []) {
      this.registerAdapter(adapter)
    }
  }

  registerAdapter(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id, adapter)
  }

  setCostEstimator(estimateCost: CostEstimator): void {
    this.estimateCost = estimateCost
  }

  async dispatch(params: DispatchSessionParams): Promise<DispatchSessionResult> {
    const threadId = this.resolveOrCreateThread(params)
    const context = buildAdapterContext(
      params.context,
      sessionsStore.listThreadTranscript(threadId, { limit: THREAD_CONTEXT_SESSION_LIMIT }),
    )

    const session = sessionsStore.create({
      projectId: params.projectId,
      agentId: params.agentId,
      model: params.model,
      prompt: params.prompt,
      imageAttachments: params.imageAttachments,
      status: 'running',
      threadId,
    })

    // Link the thread to the new session and bump updated_at so the sidebar
    // bubbles this thread to the top of its project list.
    const linkedThread = threadsStore.linkSession(threadId, session.id)
    broadcastThreadUpdated(linkedThread)

    const adapter = this.resolveAdapter(params.agentId)
    if (!adapter) {
      const error = new Error(`Adapter not found: ${params.agentId}`)
      this.failSession(session.id, error)
      throw error
    }

    try {
      const shouldIsolate = params.isolate ?? this.worktreeIsolation
      const worktreePath = shouldIsolate
        ? await worktreeManager.create(session.id, params.repoPath)
        : null
      const localBaseline = worktreePath
        ? null
        : await captureLocalChangeBaseline(params.repoPath)

      if (worktreePath) {
        this.emitSyntheticEvent(session.id, {
          kind: 'step',
          title: 'Created isolated worktree',
          detail: worktreePath,
          status: 'done',
        })
      }

      const agentSession = await adapter.dispatch({
        sessionId: session.id,
        prompt: params.prompt,
        repoPath: worktreePath ?? params.repoPath,
        model: params.model,
        context,
        imageAttachments: params.imageAttachments,
        runtimeSettings: params.runtimeSettings,
      })

      this.activeSessions.set(session.id, {
        approve: () => agentSession.approve(),
        reject: () => agentSession.reject(),
        cancel: () => agentSession.cancel(),
        repoPath: params.repoPath,
        worktreePath,
        localBaseline,
      })

      agentSession.events.on('event', (event: AgentEvent) => {
        this.handleAgentEvent({ ...event, sessionId: session.id })
      })

      return { sessionId: session.id, threadId }
    } catch (error) {
      await worktreeManager.remove(session.id, params.repoPath)
      this.failSession(session.id, error)
      throw error
    }
  }

  approve(sessionId: string): void {
    this.activeSessions.get(sessionId)?.approve()
    const session = sessionsStore.get(sessionId)
    if (session?.status === 'awaiting-approval') {
      sessionsStore.updateStatus(sessionId, 'running')
    }
  }

  reject(sessionId: string): void {
    this.activeSessions.get(sessionId)?.reject()
    const session = sessionsStore.get(sessionId)
    if (session?.status === 'awaiting-approval') {
      sessionsStore.updateStatus(sessionId, 'running')
    }
  }

  cancel(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    this.activeSessions.delete(sessionId)
    this.processWarningsBySession.delete(sessionId)
    this.sessionsPausedForUserInput.delete(sessionId)
    const session = sessionsStore.get(sessionId)

    if (session && !terminalSessionStatuses.has(session.status)) {
      sessionsStore.updateStatus(sessionId, 'cancelled')

      // Emit a synthetic completion so subscribers (sidebar spinner, tab
      // status, workspace controller) see the transition. Once the store is
      // marked cancelled, any real `session-complete` arriving later from the
      // killed agent process is filtered out by `isTerminalSession`.
      this.recordEvent({
        type: 'session-complete',
        sessionId,
        payload: { status: 'cancelled' },
        timestamp: Date.now(),
      })
    }

    active?.cancel()
    void worktreeManager.remove(sessionId, active?.repoPath)
  }

  cancelAll(): void {
    for (const sessionId of this.activeSessions.keys()) {
      this.cancel(sessionId)
    }
  }

  isActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId)
  }

  enqueueMessage(
    params: { prompt: string; agentId: AgentId; model: string },
    threadId: string,
  ): QueuedMessage {
    const message: QueuedMessage = {
      id: randomUUID(),
      prompt: params.prompt,
      agentId: params.agentId,
      model: params.model,
      createdAt: Date.now(),
    }

    const queue = this.pendingQueues.get(threadId) ?? []
    const updated = [...queue, message]
    this.pendingQueues.set(threadId, updated)
    broadcastQueueUpdated(threadId, updated)
    return message
  }

  getQueue(threadId: string): QueuedMessage[] {
    return [...(this.pendingQueues.get(threadId) ?? [])]
  }

  removeQueueItem(threadId: string, messageId: string): void {
    const queue = this.pendingQueues.get(threadId)
    if (!queue) return

    const updated = queue.filter((message) => message.id !== messageId)
    if (updated.length === queue.length) return

    if (updated.length === 0) {
      this.pendingQueues.delete(threadId)
    } else {
      this.pendingQueues.set(threadId, updated)
    }
    broadcastQueueUpdated(threadId, updated)
  }

  clearQueue(threadId: string): void {
    if (!this.pendingQueues.has(threadId)) return

    this.pendingQueues.delete(threadId)
    broadcastQueueUpdated(threadId, [])
  }

  async steer(params: {
    sessionId: string
    projectId: string
    prompt: string
    agentId: AgentId
    model: string
    repoPath: string
    context?: string | null
    imageAttachments?: ImageAttachment[]
    isolate?: boolean
    runtimeSettings?: AgentRuntimeSettings
  }): Promise<DispatchSessionResult> {
    const session = sessionsStore.get(params.sessionId)
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`)
    }
    if (!session.threadId) {
      throw new Error(`Session ${params.sessionId} has no thread to steer`)
    }

    if (this.activeSessions.has(params.sessionId)) {
      this.cancel(params.sessionId)
    }

    return this.dispatch({
      projectId: params.projectId,
      prompt: params.prompt,
      agentId: params.agentId,
      model: params.model,
      repoPath: params.repoPath,
      context: params.context,
      imageAttachments: params.imageAttachments,
      isolate: params.isolate,
      runtimeSettings: params.runtimeSettings,
      threadId: session.threadId,
    })
  }

  private resolveAdapter(agentId: AgentId): AgentAdapter | undefined {
    return this.adapterResolver?.(agentId) ?? this.adapters.get(agentId)
  }

  private resolveOrCreateThread(params: DispatchSessionParams): string {
    if (params.threadId) {
      const existing = threadsStore.get(params.threadId)
      if (!existing) {
        throw new Error(`Thread not found: ${params.threadId}`)
      }
      if (existing.projectId !== params.projectId) {
        throw new Error(
          `Thread ${params.threadId} belongs to a different project (${existing.projectId})`,
        )
      }
      return existing.id
    }

    const title = params.prompt.trim().slice(0, 60) || 'Untitled thread'
    const created = threadsStore.create({ projectId: params.projectId, title })
    broadcastThreadUpdated(created)
    return created.id
  }

  private handleAgentEvent(event: AgentEvent): void {
    if (this.sessionsPausedForUserInput.has(event.sessionId)) return

    if (event.type === 'approval-request') {
      if (this.isTerminalSession(event.sessionId)) return

      this.recordActivityEvents(event)
      sessionsStore.updateStatus(event.sessionId, 'awaiting-approval')
      this.recordEvent(event)
      return
    }

    if (event.type === 'session-complete') {
      if (this.isTerminalSession(event.sessionId)) return

      const status = completionStatus(event)
      const completedEvent = withCompletionStatus(event, status)
      const active = this.activeSessions.get(event.sessionId)
      const session = sessionsStore.get(event.sessionId)

      this.applyUsage(event)
      sessionsStore.updateStatus(event.sessionId, status)
      this.activeSessions.delete(event.sessionId)
      this.processWarningsBySession.delete(event.sessionId)

      void this.emitCompletionDiffs(event.sessionId, active, completedEvent).then(() => {
        if (status !== 'done') return
        if (!active) return
        if (!session?.threadId) {
          console.warn(
            `[session] skipping queued dispatch: session ${event.sessionId} missing thread on completion`,
          )
          return
        }

        void this.dispatchNextQueued(session.threadId, {
          projectId: session.projectId,
          repoPath: active.repoPath,
        })
      })
      return
    }

    if (event.type === 'error') {
      if (this.isTerminalSession(event.sessionId)) return

      const active = this.activeSessions.get(event.sessionId)
      sessionsStore.updateStatus(event.sessionId, 'error')
      this.recordEvent(event)
      void this.removeWorktree(event.sessionId, active)
      this.activeSessions.delete(event.sessionId)
      this.processWarningsBySession.delete(event.sessionId)
      return
    }

    this.recordEvent(event)
    this.recordActivityEvents(event)
  }

  private recordEvent(event: AgentEvent): void {
    sessionsStore.addEvent(event)
    this.broadcastEvent(event)
  }

  private recordActivityEvents(event: AgentEvent): void {
    let shouldPauseForUserInput = false

    for (const activityEvent of deriveActivityEvents(event)) {
      if (this.hasSeenProcessWarning(activityEvent)) continue

      this.recordEvent(activityEvent)
      if (isUserQuestionActivity(activityEvent.payload)) {
        shouldPauseForUserInput = true
      }
    }

    if (shouldPauseForUserInput) {
      this.pauseForUserInput(event.sessionId)
    }
  }

  private pauseForUserInput(sessionId: string): void {
    const session = sessionsStore.get(sessionId)
    if (!session || terminalSessionStatuses.has(session.status)) return

    sessionsStore.updateStatus(sessionId, 'awaiting-input')
    const active = this.activeSessions.get(sessionId)
    this.sessionsPausedForUserInput.add(sessionId)
    this.activeSessions.delete(sessionId)
    this.processWarningsBySession.delete(sessionId)

    if (!active) return

    active.cancel()
    void this.removeWorktree(sessionId, active)
  }

  private hasSeenProcessWarning(event: AgentEvent): boolean {
    const key = processWarningActivityKey(event)
    if (!key) return false

    const seen = this.processWarningsBySession.get(event.sessionId) ?? new Set<string>()
    if (seen.has(key)) return true

    seen.add(key)
    this.processWarningsBySession.set(event.sessionId, seen)
    return false
  }

  private isTerminalSession(sessionId: string): boolean {
    const session = sessionsStore.get(sessionId)
    return session ? terminalSessionStatuses.has(session.status) : false
  }

  private emitSyntheticEvent(sessionId: string, payload: AgentEvent['payload']): void {
    this.handleAgentEvent({
      type: 'activity',
      sessionId,
      payload,
      timestamp: Date.now(),
    })
  }

  private async emitCompletionDiffs(
    sessionId: string,
    active: ActiveSession | undefined,
    finalEvent: AgentEvent,
  ): Promise<void> {
    if (!active) {
      this.recordEvent(finalEvent)
      return
    }

    if (!active.worktreePath && !active.localBaseline) {
      this.recordEvent(finalEvent)
      return
    }

    try {
      const proposals = active.worktreePath
        ? await buildDiffProposals(active.worktreePath, active.repoPath)
        : active.localBaseline
          ? await buildLocalDiffProposals(active.repoPath, active.localBaseline)
          : []
      if (proposals.length > 0) {
        const reviewedProposals = active.worktreePath
          ? await this.applyDiffProposals(sessionId, proposals)
          : proposals
        this.handleAgentEvent({
          type: 'diff',
          sessionId,
          payload: reviewedProposals,
          timestamp: Date.now(),
        })
      } else if (active.localBaseline) {
        this.recordEvent({
          type: 'activity',
          sessionId,
          payload: {
            kind: 'step',
            title: 'No code changes detected',
            detail: 'Agent finished without modifying tracked files.',
            status: 'done',
          },
          timestamp: Date.now(),
        })
      }
    } catch (error) {
      this.recordEvent({
        type: 'activity',
        sessionId,
        payload: {
          kind: 'step',
          title: 'Review preparation failed',
          detail: errorMessage(error),
          status: 'error',
        },
        timestamp: Date.now(),
      })
    } finally {
      await this.removeWorktree(sessionId, active)
      this.recordEvent(finalEvent)
    }
  }

  private async applyDiffProposals(
    sessionId: string,
    proposals: DiffProposal[],
  ): Promise<DiffProposal[]> {
    const reviewedProposals: DiffProposal[] = []
    const conflicts: string[] = []

    for (const proposal of proposals) {
      try {
        await applyDiffContent(
          proposal.filePath,
          proposal.proposedContent,
          proposal.originalContent,
        )
        reviewedProposals.push({ ...proposal, status: 'applied' })
      } catch (error) {
        conflicts.push(`${proposal.filePath}: ${errorMessage(error)}`)
        reviewedProposals.push({ ...proposal, status: 'conflict' })
      }
    }

    const appliedCount = reviewedProposals.filter(
      (proposal) => proposal.status === 'applied',
    ).length

    if (appliedCount > 0) {
      this.recordEvent({
        type: 'activity',
        sessionId,
        payload: {
          kind: 'step',
          title: 'Applied code changes',
          detail: `${appliedCount} file${appliedCount === 1 ? '' : 's'} applied automatically.`,
          status: 'done',
        },
        timestamp: Date.now(),
      })
    }

    if (conflicts.length > 0) {
      this.recordEvent({
        type: 'activity',
        sessionId,
        payload: {
          kind: 'step',
          title: 'Some code changes could not be applied',
          detail: conflicts.join('\n'),
          status: 'error',
        },
        timestamp: Date.now(),
      })
    }

    return reviewedProposals
  }

  private async removeWorktree(
    sessionId: string,
    active = this.activeSessions.get(sessionId),
  ): Promise<void> {
    await worktreeManager.remove(sessionId, active?.repoPath)
  }

  private applyUsage(event: AgentEvent): void {
    const usage = extractUsage(event.payload)
    if (!usage) return

    const session = sessionsStore.get(event.sessionId)
    if (!session) return

    const costUsd =
      usage.costUsd ?? this.estimateCost(session.model, usage.tokensIn, usage.tokensOut)

    sessionsStore.updateUsage(event.sessionId, usage.tokensIn, usage.tokensOut, costUsd)
  }

  private async dispatchNextQueued(
    threadId: string,
    fallback: { projectId: string; repoPath: string },
  ): Promise<void> {
    const queue = this.pendingQueues.get(threadId)
    if (!queue?.length) return

    const [next, ...rest] = queue
    if (rest.length === 0) {
      this.pendingQueues.delete(threadId)
    } else {
      this.pendingQueues.set(threadId, rest)
    }
    broadcastQueueUpdated(threadId, rest)

    try {
      await this.dispatch({
        projectId: fallback.projectId,
        prompt: next.prompt,
        agentId: next.agentId,
        model: next.model,
        repoPath: fallback.repoPath,
        threadId,
      })
    } catch (error) {
      // dispatch() invokes failSession() on most error paths, which already
      // broadcasts an `error` event scoped to the real sessionId. The renderer
      // also sees the queue shrink via the earlier broadcastQueueUpdated call,
      // so we only need to surface unhandled cases (e.g. thread resolution
      // failures that happen before a session is created) to the main log.
      console.error(
        `[session] queued dispatch failed for thread ${threadId}:`,
        errorMessage(error),
      )
    }
  }

  private failSession(sessionId: string, error: unknown): void {
    const event: AgentEvent = {
      type: 'error',
      sessionId,
      payload: { message: errorMessage(error) },
      timestamp: Date.now(),
    }

    sessionsStore.addEvent(event)
    sessionsStore.updateStatus(sessionId, 'error')
    this.broadcastEvent(event)
    this.activeSessions.delete(sessionId)
    this.processWarningsBySession.delete(sessionId)
    this.sessionsPausedForUserInput.delete(sessionId)
  }
}

export const sessionManager = new SessionManager()

function processWarningActivityKey(event: AgentEvent): string | null {
  if (event.type !== 'activity') return null
  if (!isProcessWarningPayload(event.payload)) return null

  return processWarningKey(event.payload.detail)
}

function isUserQuestionActivity(payload: unknown): payload is Extract<
  AgentActivity,
  { kind: 'user-question' }
> {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { kind?: unknown }).kind === 'user-question'
  )
}

function completionStatus(event: AgentEvent): SessionStatus {
  const payload = objectPayload(event.payload)
  const status = readSessionStatus(payload, 'status')
  if (status && terminalSessionStatuses.has(status)) return status

  const exitCode = readNumber(payload, 'exitCode')
  const signal = payload.signal

  if (exitCode !== undefined && exitCode !== 0) return 'error'
  if (typeof signal === 'string' && signal.trim()) return 'cancelled'

  return 'done'
}

function withCompletionStatus(event: AgentEvent, status: SessionStatus): AgentEvent {
  const payload = objectPayload(event.payload)
  return {
    ...event,
    payload:
      Object.keys(payload).length > 0
        ? { ...payload, status }
        : { status, value: event.payload },
  }
}

function broadcastToRenderer(event: AgentEvent): void {
  try {
    const electron = require('electron') as {
      BrowserWindow?: {
        getAllWindows(): Array<{ webContents: { send(channel: string, payload: AgentEvent): void } }>
      }
    }

    for (const win of electron.BrowserWindow?.getAllWindows() ?? []) {
      win.webContents.send(`session:${event.sessionId}`, event)
    }
  } catch {
    // Unit tests and non-Electron contexts can provide an explicit broadcaster.
  }
}

function broadcastQueueUpdated(threadId: string, pending: QueuedMessage[]): void {
  try {
    const electron = require('electron') as {
      BrowserWindow?: {
        getAllWindows(): Array<{
          webContents: { send(channel: string, payload: QueueStatusEvent): void }
        }>
      }
    }

    const payload: QueueStatusEvent = { threadId, pending }
    for (const win of electron.BrowserWindow?.getAllWindows() ?? []) {
      win.webContents.send('queue:updated', payload)
    }
  } catch {
    // Unit tests and non-Electron contexts: silently noop.
  }
}

function broadcastThreadUpdated(thread: Thread): void {
  try {
    const electron = require('electron') as {
      BrowserWindow?: {
        getAllWindows(): Array<{
          webContents: { send(channel: string, payload: ThreadUpdatedEvent): void }
        }>
      }
    }

    const payload: ThreadUpdatedEvent = { threadId: thread.id, thread }
    for (const win of electron.BrowserWindow?.getAllWindows() ?? []) {
      win.webContents.send('thread:updated', payload)
    }
  } catch {
    // Unit tests and non-Electron contexts: silently noop.
  }
}

function extractUsage(payload: unknown):
  | { tokensIn: number; tokensOut: number; costUsd?: number }
  | null {
  const payloadObject = objectPayload(payload)
  const usageObject = objectPayload(payloadObject.usage) ?? payloadObject

  const tokensIn =
    readNumber(usageObject, 'input_tokens') ??
    readNumber(usageObject, 'inputTokens') ??
    readNumber(usageObject, 'tokens_in') ??
    readNumber(usageObject, 'tokensIn') ??
    0
  const tokensOut =
    readNumber(usageObject, 'output_tokens') ??
    readNumber(usageObject, 'outputTokens') ??
    readNumber(usageObject, 'tokens_out') ??
    readNumber(usageObject, 'tokensOut') ??
    0
  const costUsd =
    readNumber(usageObject, 'cost_usd') ??
    readNumber(usageObject, 'costUsd') ??
    readNumber(payloadObject, 'cost_usd') ??
    readNumber(payloadObject, 'costUsd')

  if (tokensIn === 0 && tokensOut === 0 && costUsd === undefined) {
    return null
  }

  return { tokensIn, tokensOut, costUsd }
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readNumber(object: Record<string, unknown>, key: string): number | undefined {
  const value = object[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readSessionStatus(
  object: Record<string, unknown>,
  key: string,
): SessionStatus | undefined {
  const value = object[key]
  return typeof value === 'string' && isSessionStatus(value) ? value : undefined
}

function isSessionStatus(value: string): value is SessionStatus {
  return (
    value === 'running' ||
    value === 'awaiting-approval' ||
    value === 'awaiting-input' ||
    value === 'done' ||
    value === 'error' ||
    value === 'cancelled'
  )
}

function isProcessWarningPayload(payload: unknown): payload is {
  kind: 'step'
  title: 'Process warning'
  detail: string
} {
  if (!payload || typeof payload !== 'object') return false

  const record = payload as Record<string, unknown>
  return (
    record.kind === 'step' &&
    record.title === 'Process warning' &&
    typeof record.detail === 'string' &&
    processWarningKey(record.detail).length > 0
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function buildAdapterContext(
  baseContext: string | null | undefined,
  transcript: ThreadTranscriptTurn[],
): string | null | undefined {
  const trimmedContext = baseContext?.trim()
  const historyBlock = buildThreadHistoryBlock(transcript)

  if (!historyBlock) return baseContext
  if (!trimmedContext) return historyBlock

  return `${trimmedContext}\n\n${historyBlock}`
}

function buildThreadHistoryBlock(transcript: ThreadTranscriptTurn[]): string | null {
  const turns = transcript
    .filter((turn) => turn.prompt.trim() || turn.assistantText?.trim())
    .map((turn, index) => {
      const parts = [
        `Turn ${index + 1}`,
        `User: ${truncateForContext(turn.prompt, THREAD_CONTEXT_PROMPT_CHARS)}`,
      ]
      const assistantText = turn.assistantText?.trim()
      if (assistantText) {
        parts.push(
          `Assistant: ${truncateForContext(assistantText, THREAD_CONTEXT_ASSISTANT_CHARS)}`,
        )
      }

      return parts.join('\n')
    })

  if (turns.length === 0) return null

  return `Conversation history (same thread, oldest to newest):\n${turns.join('\n\n')}`
}

function truncateForContext(value: string, maxChars: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxChars) return trimmed

  return `${trimmed.slice(0, maxChars).trimEnd()}\n[truncated]`
}
