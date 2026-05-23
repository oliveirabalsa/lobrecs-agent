import type { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import type {
  AgentActivity,
  AgentApprovalMode,
  AgentEvent,
  AgentId,
  AgentPlanReviewDecisionPayload,
  AgentRuntimeSettings,
  QueuedMessage,
  QueueStatusEvent,
  Session,
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
import { buildPlanExecutionPrompt, buildPlanModeContext } from './planModePrompt'
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
    modelFallbacks?: string[]
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
  modelFallbacks?: string[]
  repoPath: string
  context?: string | null
  /**
   * Optional override for the query used to retrieve repository context.
   * Defaults to `prompt`. Plan mode's execution session sets this to the
   * original task so context retrieval is not poisoned by the generic
   * "plan approved" prompt the agent actually receives.
   */
  contextQuery?: string
  imageAttachments?: ImageAttachment[]
  runtimeSettings?: AgentRuntimeSettings
  isolate?: boolean
  qualityAttempt?: number
  /** When provided, links the new session to an existing thread. */
  threadId?: string
  /**
   * When true the prompt is wrapped with planning instructions and, on a
   * successful completion, a `plan-review` activity is emitted instead of
   * draining the thread queue. Execution waits for `resolvePlanReview`.
   */
  planMode?: boolean
}

export type DispatchSessionResult = {
  sessionId: string
  threadId: string
}

export type EventBroadcaster = (event: AgentEvent) => void
export type CostEstimator = (model: string, tokensIn: number, tokensOut: number) => number
export type AdapterResolver = (agentId: AgentId) => AgentAdapter | undefined
export type SessionContextResolver = (input: {
  projectId: string
  repoPath: string
  prompt: string
  baseContext?: string | null
}) => Promise<string | null>
export type QualityGateRunner = (input: {
  sessionId: string
  threadId: string
  projectId: string
  repoPath: string
  changedFiles: DiffProposal[]
  attempt: number
  emitActivity(payload: AgentActivity): void
}) => Promise<void>

type ActiveSession = Pick<AgentSession, 'approve' | 'reject' | 'cancel'> & {
  repoPath: string
  threadId: string
  worktreePath: string | null
  localBaseline: LocalChangeBaseline | null
  liveDiffTimer?: ReturnType<typeof setTimeout>
  liveDiffSignature?: string
  lastAgentEventAt: number
  lastIdleHeartbeatAt: number
  idleHeartbeatTimer?: ReturnType<typeof setTimeout>
  qualityAttempt: number
  /** True when this session was dispatched as the planning phase of plan mode. */
  planMode: boolean
  /** Carried so the gated execution session can re-dispatch with the same config. */
  isolate: boolean
  runtimeSettings?: AgentRuntimeSettings
  /** Raw project context — carried so a gated execution session resolves with parity. */
  baseContext?: string | null
}

/**
 * A plan awaiting the user's Approve/Reject decision. Holds everything needed
 * to dispatch the execution session once `resolvePlanReview` is called.
 */
type PlanReviewRecord = {
  reviewId: string
  planningSessionId: string
  projectId: string
  threadId: string
  repoPath: string
  agentId: AgentId
  model: string
  isolate: boolean
  runtimeSettings?: AgentRuntimeSettings
  /**
   * The original user task. Used as the execution session's context-retrieval
   * query so repo context stays task-relevant — the agent prompt itself is the
   * generic `buildPlanExecutionPrompt()` string, which is useless as a query.
   */
  taskPrompt: string
  /** The planning session's raw project context, replayed for the execution session. */
  baseContext?: string | null
}

export type PlanReviewSnapshot = Pick<
  PlanReviewRecord,
  'reviewId' | 'planningSessionId' | 'projectId' | 'agentId' | 'model'
> & {
  runtimePermissionMode?: AgentRuntimeSettings['permissionMode']
}

export type PlanReviewExecutionOptions = {
  runtimeSettings?: AgentRuntimeSettings
  modelFallbacks?: string[]
}

type PendingQueuedMessage = QueuedMessage & {
  runtimeSettings?: AgentRuntimeSettings
}

const terminalSessionStatuses = new Set<SessionStatus>(['done', 'error', 'cancelled'])
const THREAD_CONTEXT_SESSION_LIMIT = 6
const THREAD_CONTEXT_PROMPT_CHARS = 2_000
const THREAD_CONTEXT_ASSISTANT_CHARS = 4_000
const LIVE_DIFF_DEBOUNCE_MS = 120

export type SessionManagerOptions = {
  adapters?: Iterable<AgentAdapter>
  adapterResolver?: AdapterResolver
  broadcast?: EventBroadcaster
  estimateCost?: CostEstimator
  worktreeIsolation?: boolean
  resolveContext?: SessionContextResolver
  qualityGateRunner?: QualityGateRunner
  idleHeartbeatMs?: number | false
}

export class SessionManager {
  private readonly adapters = new Map<AgentId, AgentAdapter>()
  private readonly activeSessions = new Map<string, ActiveSession>()
  private readonly adapterResolver?: AdapterResolver
  private readonly broadcastEvent: EventBroadcaster
  private readonly worktreeIsolation: boolean
  private readonly processWarningsBySession = new Map<string, Set<string>>()
  private readonly sessionsPausedForUserInput = new Set<string>()
  private readonly pendingQueues = new Map<string, PendingQueuedMessage[]>()
  /** Plans awaiting an Approve/Reject decision, keyed by reviewId. */
  private readonly pendingPlanReviews = new Map<string, PlanReviewRecord>()
  private estimateCost: CostEstimator
  private resolveContext?: SessionContextResolver
  private qualityGateRunner?: QualityGateRunner
  private readonly idleHeartbeatMs: number | false

  constructor(options: SessionManagerOptions = {}) {
    this.adapterResolver = options.adapterResolver
    this.broadcastEvent = options.broadcast ?? broadcastToRenderer
    this.worktreeIsolation = options.worktreeIsolation ?? false
    this.estimateCost = options.estimateCost ?? (() => 0)
    this.resolveContext = options.resolveContext
    this.qualityGateRunner = options.qualityGateRunner
    this.idleHeartbeatMs = options.idleHeartbeatMs ?? 45_000

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

  setContextResolver(resolveContext: SessionContextResolver): void {
    this.resolveContext = resolveContext
  }

  setQualityGateRunner(runner: QualityGateRunner | undefined): void {
    this.qualityGateRunner = runner
  }

  async dispatch(params: DispatchSessionParams): Promise<DispatchSessionResult> {
    const shouldIsolate = params.isolate ?? this.worktreeIsolation

    const threadId = this.resolveOrCreateThread(params)
    const sessionId = randomUUID()
    let sessionCreated = false

    try {
      const baseContext = await this.resolveDispatchContext(params)
      const context = buildAdapterContext(
        baseContext,
        sessionsStore.listThreadTranscript(threadId, { limit: THREAD_CONTEXT_SESSION_LIMIT }),
      )

      const session = sessionsStore.create({
        id: sessionId,
        projectId: params.projectId,
        agentId: params.agentId,
        model: params.model,
        prompt: params.prompt,
        imageAttachments: params.imageAttachments,
        planMode: params.planMode ?? false,
        status: 'running',
        threadId,
      })
      sessionCreated = true

      // Link the thread to the new session and bump updated_at so the sidebar
      // bubbles this thread to the top of its project list.
      const linkedThread = threadsStore.linkSession(threadId, session.id)
      broadcastThreadUpdated(linkedThread)

      const adapter = this.resolveAdapter(params.agentId)
      if (!adapter) {
        throw new Error(`Adapter not found: ${params.agentId}`)
      }

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

      // Plan mode appends instructions to adapter context while leaving the
      // adapter prompt as the user's real task. If the prompt itself becomes
      // "create a plan", external CLIs can produce a meta-plan instead of a
      // plan for the requested implementation.
      const adapterContext = params.planMode
        ? buildPlanModeContext(context)
        : context

      const agentSession = await adapter.dispatch({
        sessionId: session.id,
        prompt: params.prompt,
        repoPath: worktreePath ?? params.repoPath,
        model: params.model,
        modelFallbacks: params.modelFallbacks,
        context: adapterContext,
        imageAttachments: params.imageAttachments,
        runtimeSettings: params.runtimeSettings,
      })

      this.activeSessions.set(session.id, {
        approve: () => agentSession.approve(),
        reject: () => agentSession.reject(),
        cancel: () => agentSession.cancel(),
        repoPath: params.repoPath,
        threadId,
        worktreePath,
        localBaseline,
        lastAgentEventAt: Date.now(),
        lastIdleHeartbeatAt: 0,
        qualityAttempt: params.qualityAttempt ?? 0,
        planMode: params.planMode ?? false,
        isolate: shouldIsolate,
        runtimeSettings: params.runtimeSettings,
        baseContext: params.context,
      })
      this.scheduleIdleHeartbeat(session.id)

      agentSession.events.on('event', (event: AgentEvent) => {
        this.handleAgentEvent({ ...event, sessionId: session.id })
      })

      return { sessionId: session.id, threadId }
    } catch (error) {
      await worktreeManager.remove(sessionId, params.repoPath)
      if (sessionCreated) {
        this.failSession(sessionId, error)
      }
      throw error
    }
  }

  approve(sessionId: string): void {
    this.activeSessions.get(sessionId)?.approve()
    const session = sessionsStore.get(sessionId)
    if (session?.status === 'awaiting-approval') {
      sessionsStore.updateStatus(sessionId, 'running')
      this.noteAgentEvent(sessionId)
    }
  }

  reject(sessionId: string): void {
    this.activeSessions.get(sessionId)?.reject()
    const session = sessionsStore.get(sessionId)
    if (session?.status === 'awaiting-approval') {
      sessionsStore.updateStatus(sessionId, 'running')
      this.noteAgentEvent(sessionId)
    }
  }

  cancel(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    this.stopIdleHeartbeat(sessionId)
    this.activeSessions.delete(sessionId)
    this.processWarningsBySession.delete(sessionId)
    this.sessionsPausedForUserInput.delete(sessionId)
    this.dropPlanReviewsForSession(sessionId)
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
    params: {
      prompt: string
      agentId: AgentId
      model: string
      approvalMode?: AgentApprovalMode
      runtimeSettings?: AgentRuntimeSettings
    },
    threadId: string,
  ): QueuedMessage {
    const message: PendingQueuedMessage = {
      id: randomUUID(),
      prompt: params.prompt,
      agentId: params.agentId,
      model: params.model,
      approvalMode: params.approvalMode,
      runtimeSettings: params.runtimeSettings,
      createdAt: Date.now(),
    }

    const queue = this.pendingQueues.get(threadId) ?? []
    const updated = [...queue, message]
    this.pendingQueues.set(threadId, updated)
    broadcastQueueUpdated(threadId, publicQueuedMessages(updated))
    return publicQueuedMessage(message)
  }

  getQueue(threadId: string): QueuedMessage[] {
    return publicQueuedMessages(this.pendingQueues.get(threadId) ?? [])
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
    broadcastQueueUpdated(threadId, publicQueuedMessages(updated))
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
    modelFallbacks?: string[]
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
      modelFallbacks: params.modelFallbacks,
      repoPath: params.repoPath,
      context: params.context,
      imageAttachments: params.imageAttachments,
      isolate: params.isolate,
      runtimeSettings: params.runtimeSettings,
      threadId: session.threadId,
    })
  }

  /**
   * Resolves a plan awaiting review.
   *
   * On `approve` this dispatches the gated execution session on the planning
   * session's thread — the very gate of plan mode: the execution session does
   * not exist until this call. On `reject` the plan is discarded and any
   * follow-ups queued while the plan was pending are released to run.
   *
   * Returns the execution session identifiers on approval, or `null` when the
   * review was rejected or is unknown (already resolved).
   */
  async resolvePlanReview(
    payload: AgentPlanReviewDecisionPayload,
    executionOptions: PlanReviewExecutionOptions = {},
  ): Promise<DispatchSessionResult | null> {
    const record = this.pendingPlanReviews.get(payload.reviewId)
    if (!record) return null

    // The decision must come from the UI bound to the planning session that
    // produced this plan. A `sessionId` mismatch means a stale or misrouted
    // event — ignore it WITHOUT consuming the review, so the correctly paired
    // decision can still resolve it.
    if (payload.sessionId !== record.planningSessionId) return null

    if (payload.decision === 'reject') {
      this.pendingPlanReviews.delete(payload.reviewId)
      // The plan is discarded, but the planning turn is over. Release the
      // thread by draining its queue so follow-ups enqueued while the plan
      // was pending are not stranded. `dispatchNextQueued` only drains an
      // idle thread: if another session is still running here it leaves the
      // queue intact and that session's own completion drains it in order.
      // An empty queue makes this a no-op.
      void this.dispatchNextQueued(record.threadId, {
        projectId: record.projectId,
        repoPath: record.repoPath,
      })
      return null
    }

    if (payload.agentId && payload.agentId !== record.agentId && !payload.modelOverride) {
      throw new Error('Plan approval selected a different agent without an implementation model')
    }

    const execution = await this.dispatch({
      projectId: record.projectId,
      prompt: buildPlanExecutionPrompt({
        editedPlanText: payload.editedPlanText,
        suggestionText: payload.suggestionText,
      }),
      // The agent prompt is generic, so retrieve repo context with the
      // original task instead; base context is replayed for parity with the
      // planning session.
      contextQuery: record.taskPrompt,
      context: record.baseContext,
      agentId: payload.agentId ?? record.agentId,
      model: payload.modelOverride ?? record.model,
      modelFallbacks: executionOptions.modelFallbacks,
      repoPath: record.repoPath,
      threadId: record.threadId,
      isolate: record.isolate,
      runtimeSettings: executionOptions.runtimeSettings ?? record.runtimeSettings,
    })
    this.pendingPlanReviews.delete(payload.reviewId)
    return execution
  }

  getPendingPlanReview(reviewId: string): PlanReviewSnapshot | null {
    const record = this.pendingPlanReviews.get(reviewId)
    if (!record) return null

    return {
      reviewId: record.reviewId,
      planningSessionId: record.planningSessionId,
      projectId: record.projectId,
      agentId: record.agentId,
      model: record.model,
      runtimePermissionMode: record.runtimeSettings?.permissionMode,
    }
  }

  /**
   * Completion path for a plan-mode planning session.
   *
   * Unlike the normal path this never builds, applies, or quality-gates
   * diffs — the planning phase must leave the repo untouched until the user
   * approves. A cleanly finished plan surfaces a `plan-review` activity; a
   * failed plan just records its terminal event with nothing to approve.
   */
  private async completePlanModeSession(
    sessionId: string,
    active: ActiveSession,
    finalEvent: AgentEvent,
    session: Session | null,
  ): Promise<void> {
    try {
      // Drop the planning worktree (if any). Stray edits the agent made
      // despite the no-changes instruction are isolated there and discarded.
      await this.removeWorktree(sessionId, active)
    } finally {
      this.recordEvent(finalEvent)
    }

    if (completionStatus(finalEvent) === 'done' && session) {
      this.registerPlanReview(sessionId, active, session)
    }
  }

  /**
   * Records a finished plan-mode session's plan as awaiting review and emits
   * the `plan-review` activity that the renderer pairs with an Approve/Reject
   * card. Emitted after the `session-complete` event so it attaches to the
   * completed turn.
   */
  private registerPlanReview(
    sessionId: string,
    active: ActiveSession,
    session: Session,
  ): void {
    const reviewId = randomUUID()
    this.pendingPlanReviews.set(reviewId, {
      reviewId,
      planningSessionId: sessionId,
      projectId: session.projectId,
      threadId: active.threadId,
      repoPath: active.repoPath,
      agentId: session.agentId,
      model: session.model,
      isolate: active.isolate,
      runtimeSettings: active.runtimeSettings,
      // `session.prompt` is the original task — plan mode only wraps the
      // adapter prompt, never the stored prompt.
      taskPrompt: session.prompt,
      baseContext: active.baseContext,
    })

    this.recordEvent({
      type: 'activity',
      sessionId,
      payload: { kind: 'plan-review', reviewId, agentId: session.agentId, model: session.model },
      timestamp: Date.now(),
    })
  }

  /** Drops any pending plan reviews tied to a session (e.g. on cancellation). */
  private dropPlanReviewsForSession(sessionId: string): void {
    for (const [reviewId, record] of this.pendingPlanReviews) {
      if (record.planningSessionId === sessionId) {
        this.pendingPlanReviews.delete(reviewId)
      }
    }
  }

  private resolveAdapter(agentId: AgentId): AgentAdapter | undefined {
    return this.adapterResolver?.(agentId) ?? this.adapters.get(agentId)
  }

  private async resolveDispatchContext(
    params: DispatchSessionParams,
  ): Promise<string | null | undefined> {
    if (!this.resolveContext) return params.context

    return this.resolveContext({
      projectId: params.projectId,
      repoPath: params.repoPath,
      // `contextQuery` lets a caller decouple the retrieval query from the
      // prompt the agent receives (see plan mode's execution session).
      prompt: params.contextQuery ?? params.prompt,
      baseContext: params.context,
    })
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
    this.noteAgentEvent(event.sessionId)

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
      this.stopIdleHeartbeat(event.sessionId)
      this.stopLiveDiff(event.sessionId)
      this.activeSessions.delete(event.sessionId)
      this.processWarningsBySession.delete(event.sessionId)

      // A plan-mode planning session bypasses the diff/quality pipeline
      // entirely: the repo must stay untouched until the user approves, so
      // diffs are never auto-applied and the quality gate never runs before
      // review. This branch must precede `emitCompletionDiffs`.
      if (active?.planMode) {
        void this.completePlanModeSession(event.sessionId, active, completedEvent, session)
        return
      }

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
      this.stopIdleHeartbeat(event.sessionId)
      this.stopLiveDiff(event.sessionId)
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

  private noteAgentEvent(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    if (!active) return

    active.lastAgentEventAt = Date.now()
    this.scheduleIdleHeartbeat(sessionId)
  }

  private scheduleIdleHeartbeat(sessionId: string): void {
    if (this.idleHeartbeatMs === false) return

    const active = this.activeSessions.get(sessionId)
    if (!active) return

    if (active.idleHeartbeatTimer) {
      clearTimeout(active.idleHeartbeatTimer)
    }

    active.idleHeartbeatTimer = setTimeout(() => {
      this.emitIdleHeartbeat(sessionId)
    }, this.idleHeartbeatMs)
    active.idleHeartbeatTimer.unref?.()
  }

  private emitIdleHeartbeat(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    if (!active || this.idleHeartbeatMs === false) return

    const session = sessionsStore.get(sessionId)
    if (!session || session.status !== 'running') return

    const now = Date.now()
    if (now - active.lastIdleHeartbeatAt < this.idleHeartbeatMs) {
      this.scheduleIdleHeartbeat(sessionId)
      return
    }

    active.lastIdleHeartbeatAt = now
    const idleSeconds = Math.max(1, Math.round((now - active.lastAgentEventAt) / 1000))
    this.recordEvent({
      type: 'activity',
      sessionId,
      payload: {
        kind: 'step',
        title: 'Waiting for agent output',
        detail: `The agent process is still running; no new stream events for ${idleSeconds}s.`,
        status: 'running',
      },
      timestamp: now,
    })
    this.scheduleIdleHeartbeat(sessionId)
  }

  private stopIdleHeartbeat(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    if (!active?.idleHeartbeatTimer) return

    clearTimeout(active.idleHeartbeatTimer)
    active.idleHeartbeatTimer = undefined
  }

  private recordActivityEvents(event: AgentEvent): void {
    let shouldPauseForUserInput = false
    let shouldRefreshLiveDiff = shouldTriggerLiveLocalDiff(event)

    for (const activityEvent of deriveActivityEvents(event)) {
      if (this.hasSeenProcessWarning(activityEvent)) continue

      this.recordEvent(activityEvent)
      if (shouldTriggerLiveLocalDiff(activityEvent)) {
        shouldRefreshLiveDiff = true
      }
      if (isUserQuestionActivity(activityEvent.payload)) {
        shouldPauseForUserInput = true
      }
    }

    if (shouldPauseForUserInput) {
      this.pauseForUserInput(event.sessionId)
    }

    if (shouldRefreshLiveDiff) {
      this.scheduleLiveLocalDiff(event.sessionId)
    }
  }

  private scheduleLiveLocalDiff(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    if (!active?.localBaseline || active.planMode) return

    if (active.liveDiffTimer) {
      clearTimeout(active.liveDiffTimer)
    }

    active.liveDiffTimer = setTimeout(() => {
      active.liveDiffTimer = undefined
      void this.emitLiveLocalDiff(sessionId)
    }, LIVE_DIFF_DEBOUNCE_MS)
    active.liveDiffTimer.unref?.()
  }

  private stopLiveDiff(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    if (!active?.liveDiffTimer) return

    clearTimeout(active.liveDiffTimer)
    active.liveDiffTimer = undefined
  }

  private async emitLiveLocalDiff(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    if (!active?.localBaseline || active.planMode) return

    try {
      const proposals = await buildLocalDiffProposals(active.repoPath, active.localBaseline)
      if (proposals.length === 0) return

      const signature = diffProposalSignature(proposals)
      if (signature === active.liveDiffSignature) return

      active.liveDiffSignature = signature
      this.handleAgentEvent({
        type: 'diff',
        sessionId,
        payload: { proposals, live: true },
        timestamp: Date.now(),
      })
    } catch {
      // Live counters are best-effort; completion still performs the authoritative diff.
    }
  }

  private pauseForUserInput(sessionId: string): void {
    const session = sessionsStore.get(sessionId)
    if (!session || terminalSessionStatuses.has(session.status)) return

    sessionsStore.updateStatus(sessionId, 'awaiting-input')
    const active = this.activeSessions.get(sessionId)
    this.sessionsPausedForUserInput.add(sessionId)
    this.stopIdleHeartbeat(sessionId)
    this.stopLiveDiff(sessionId)
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

    let changedFiles: DiffProposal[] = []

    try {
      active.liveDiffSignature = undefined
      const proposals = active.worktreePath
        ? await buildDiffProposals(active.worktreePath, active.repoPath)
        : active.localBaseline
          ? await buildLocalDiffProposals(active.repoPath, active.localBaseline)
          : []
      if (proposals.length > 0) {
        const reviewedProposals = active.worktreePath
          ? await this.applyDiffProposals(sessionId, proposals)
          : proposals
        changedFiles = reviewedProposals.filter((proposal) => proposal.status === 'applied')
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
      try {
        await this.removeWorktree(sessionId, active)
      } finally {
        if (completionStatus(finalEvent) === 'done') {
          await this.runQualityGate(sessionId, active, changedFiles)
        }
        this.recordEvent(finalEvent)
      }
    }
  }

  private async runQualityGate(
    sessionId: string,
    active: ActiveSession,
    changedFiles: DiffProposal[],
  ): Promise<void> {
    if (!this.qualityGateRunner || changedFiles.length === 0) return

    const session = sessionsStore.get(sessionId)
    if (!session) return

    try {
      await this.qualityGateRunner({
        sessionId,
        threadId: active.threadId,
        projectId: session.projectId,
        repoPath: active.repoPath,
        changedFiles,
        attempt: active.qualityAttempt,
        emitActivity: (payload) => {
          this.recordEvent({
            type: 'activity',
            sessionId,
            payload,
            timestamp: Date.now(),
          })
        },
      })
    } catch (error) {
      this.recordEvent({
        type: 'activity',
        sessionId,
        payload: {
          kind: 'step',
          title: 'Automated QA failed to run',
          detail: errorMessage(error),
          status: 'error',
        },
        timestamp: Date.now(),
      })
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
    this.stopLiveDiff(sessionId)
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

  /**
   * True when a live agent session is still attached to the thread.
   *
   * Backed by `activeSessions`, which holds running and awaiting-approval
   * sessions and drops a session the instant it completes, errors, is
   * cancelled, or pauses for user input. A thread whose sessions have all
   * finished (or only paused) therefore reads as not busy.
   */
  private isThreadBusy(threadId: string): boolean {
    for (const active of this.activeSessions.values()) {
      if (active.threadId === threadId) return true
    }
    return false
  }

  private async dispatchNextQueued(
    threadId: string,
    fallback: { projectId: string; repoPath: string },
  ): Promise<void> {
    const queue = this.pendingQueues.get(threadId)
    if (!queue?.length) return

    // A queued follow-up must start on an idle thread. If a session is still
    // active here — e.g. a plan rejected while newer work runs on the same
    // thread — leave the queue intact; that session's own completion calls
    // back here and drains it in order. Without this guard a reject (or an
    // out-of-order completion) could start a second concurrent dispatch on
    // the thread and break queue ordering.
    if (this.isThreadBusy(threadId)) return

    const [next, ...rest] = queue
    if (rest.length === 0) {
      this.pendingQueues.delete(threadId)
    } else {
      this.pendingQueues.set(threadId, rest)
    }
    broadcastQueueUpdated(threadId, publicQueuedMessages(rest))

    try {
      await this.dispatch({
        projectId: fallback.projectId,
        prompt: next.prompt,
        agentId: next.agentId,
        model: next.model,
        repoPath: fallback.repoPath,
        threadId,
        runtimeSettings: next.runtimeSettings,
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
    this.stopIdleHeartbeat(sessionId)
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

function publicQueuedMessage(message: PendingQueuedMessage): QueuedMessage {
  const { runtimeSettings: _runtimeSettings, ...publicMessage } = message
  return publicMessage
}

function publicQueuedMessages(messages: readonly PendingQueuedMessage[]): QueuedMessage[] {
  return messages.map(publicQueuedMessage)
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

function shouldTriggerLiveLocalDiff(event: AgentEvent): boolean {
  if (event.type !== 'activity') return false

  const payload = event.payload
  if (!payload || typeof payload !== 'object') return false

  const kind = (payload as { kind?: unknown }).kind
  return kind === 'file-change' || kind === 'tool-call' || kind === 'command'
}

function diffProposalSignature(proposals: readonly DiffProposal[]): string {
  const hash = createHash('sha256')
  for (const proposal of [...proposals].sort((left, right) =>
    left.filePath.localeCompare(right.filePath),
  )) {
    hash.update(proposal.filePath)
    hash.update('\0')
    hash.update(proposal.changeType ?? '')
    hash.update('\0')
    hash.update(String(proposal.additions ?? 0))
    hash.update('\0')
    hash.update(String(proposal.deletions ?? 0))
    hash.update('\0')
    hash.update(proposal.proposedContent)
    hash.update('\0')
  }
  return hash.digest('hex')
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
