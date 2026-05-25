import type { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import type {
  AgentActivity,
  AgentApprovalMode,
  AgentEvent,
  AgentId,
  AgentModelRecoveryDecisionPayload,
  AgentPlanReviewDecisionPayload,
  AgentRuntimeSettings,
  QueuedMessage,
  QueueStatusEvent,
  Session,
  SpawnedAgentSession,
  ThreadTranscriptTurn,
  SessionStatus,
  SupportedAgentId,
  Thread,
  ThreadUpdatedEvent,
} from '../../shared/types'
import { processWarningKey } from '../../shared/contracts/agentOutput'
import { worktreeManager } from '../git/WorktreeManager'
import { applyDiffContent } from '../modules/diffs/application/applyDiff'
import { promptEvidenceStore, sessionsStore, threadsStore } from '../store'
import { deriveActivityEvents } from './activity'
import { buildPlanExecutionPrompt, buildPlanModeContext } from './planModePrompt'
import { buildBoundedPromptContext, truncateForContext } from '../modules/context/application/contextBudget'
import { redactSensitiveText } from '../modules/context/domain/secretRedaction'
import {
  buildLocalDiffProposals,
  captureLocalChangeBaseline,
  type LocalChangeBaseline,
} from './localDiff'
import {
  filterProposalsToTouchedFiles,
  noteTouchedFilesFromActivity,
} from './fileTouchTracking'
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
  spawnedAgent?: SpawnedAgentSession
  modelRecoveryMode?: 'prompt' | 'auto'
  /** When provided, links the new session to an existing thread. */
  threadId?: string
  /**
   * When true the prompt is wrapped with planning instructions and, on a
   * successful completion, a `plan-review` activity is emitted instead of
   * draining the thread queue. Execution waits for `resolvePlanReview`.
   */
  planMode?: boolean
  /**
   * Mirrors this spawned session back into a parent session as a compact
   * background-delegation activity. The child still runs as a normal session
   * on the same thread.
   */
  delegatedTask?: {
    delegationId?: string
    parentSessionId: string
    goal: string
  }
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

export type DelegateTaskRunner = (input: {
  parentSessionId: string
  projectId: string
  threadId: string
  goal: string
  context?: string
}) => Promise<unknown>

export type NotifierEvent =
  | {
      type: 'session.done'
      sessionId: string
      projectId: string
      threadId: string
      spawnedAgent?: SpawnedAgentSession
    }
  | {
      type: 'session.error'
      sessionId: string
      projectId: string
      threadId: string
      message: string
      spawnedAgent?: SpawnedAgentSession
    }
  | {
      type: 'diff.ready'
      sessionId: string
      projectId: string
      threadId: string
      count: number
      spawnedAgent?: SpawnedAgentSession
    }

export type NotifierCallback = (event: NotifierEvent) => void

type ActiveSession = Pick<AgentSession, 'approve' | 'reject' | 'cancel'> & {
  repoPath: string
  threadId: string
  worktreePath: string | null
  localBaseline: LocalChangeBaseline | null
  localTouchedFiles: Set<string>
  sharedLocalRepo: boolean
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
  /** Context retrieval query to preserve when a paused run is continued. */
  contextQuery?: string
  prompt: string
  agentId: AgentId
  modelFallbacks: string[]
  imageAttachments?: ImageAttachment[]
  adapterContext?: string | null
  modelRecoveryMode: 'prompt' | 'auto'
  /** Last provider-limit/capacity message observed before terminal failure. */
  providerLimitReason?: string
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

type ModelRecoveryRecord = {
  recoveryId: string
  sourceSessionId: string
  projectId: string
  threadId: string
  repoPath: string
  prompt: string
  agentId: AgentId
  model: string
  isolate: boolean
  runtimeSettings?: AgentRuntimeSettings
  baseContext?: string | null
  contextQuery?: string
  imageAttachments?: ImageAttachment[]
  planMode: boolean
  requiresImageSupport: boolean
  reason: string
}

export type ModelRecoveryExecutionOptions = {
  runtimeSettings?: AgentRuntimeSettings
  modelFallbacks?: string[]
  validateSelection?: (agentId: SupportedAgentId, model: string) => void
}

type PendingQueuedMessage = QueuedMessage & {
  runtimeSettings?: AgentRuntimeSettings
}

type DelegatedTaskRecord = {
  delegationId: string
  parentSessionId: string
  childSessionId: string
  childThreadId: string
  goal: string
  agentId: AgentId
  model: string
  lastOutput?: string
}

const terminalSessionStatuses = new Set<SessionStatus>(['done', 'error', 'cancelled'])
const THREAD_CONTEXT_SESSION_LIMIT = 6
const THREAD_CONTEXT_RECENT_TURNS = 2
const THREAD_CONTEXT_PROMPT_CHARS = 1_200
const THREAD_CONTEXT_ASSISTANT_CHARS = 2_000
const THREAD_CONTEXT_SUMMARY_CHARS = 350
const MAX_ADAPTER_CONTEXT_CHARS = 24_000
const LIVE_DIFF_DEBOUNCE_MS = 120

export type SessionManagerOptions = {
  adapters?: Iterable<AgentAdapter>
  adapterResolver?: AdapterResolver
  broadcast?: EventBroadcaster
  estimateCost?: CostEstimator
  worktreeIsolation?: boolean
  resolveContext?: SessionContextResolver
  qualityGateRunner?: QualityGateRunner
  delegateTaskRunner?: DelegateTaskRunner
  notifier?: NotifierCallback
  idleHeartbeatMs?: number | false
  maxStallMs?: number | false
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
  /** Provider-limit recoveries awaiting Continue/Cancel, keyed by recoveryId. */
  private readonly pendingModelRecoveries = new Map<string, ModelRecoveryRecord>()
  /** Background child sessions mirrored into their parent stream. */
  private readonly delegatedTasksByChildSession = new Map<string, DelegatedTaskRecord>()
  private readonly processedDelegationRequests = new Set<string>()
  private estimateCost: CostEstimator
  private resolveContext?: SessionContextResolver
  private qualityGateRunner?: QualityGateRunner
  private delegateTaskRunner?: DelegateTaskRunner
  private notifier?: NotifierCallback
  private readonly idleHeartbeatMs: number | false
  private readonly maxStallMs: number | false

  constructor(options: SessionManagerOptions = {}) {
    this.adapterResolver = options.adapterResolver
    this.broadcastEvent = options.broadcast ?? broadcastToRenderer
    this.worktreeIsolation = options.worktreeIsolation ?? false
    this.estimateCost = options.estimateCost ?? (() => 0)
    this.resolveContext = options.resolveContext
    this.qualityGateRunner = options.qualityGateRunner
    this.delegateTaskRunner = options.delegateTaskRunner
    this.notifier = options.notifier
    this.idleHeartbeatMs = options.idleHeartbeatMs ?? 45_000
    this.maxStallMs = options.maxStallMs ?? 300_000

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

  setDelegateTaskRunner(runner: DelegateTaskRunner | undefined): void {
    this.delegateTaskRunner = runner
  }

  setNotifier(notifier: NotifierCallback | undefined): void {
    this.notifier = notifier
  }

  private emitNotifierEvent(event: NotifierEvent): void {
    if (!this.notifier) return
    try {
      this.notifier(event)
    } catch (error) {
      console.error('[session] notifier callback failed:', errorMessage(error))
    }
  }

  async dispatch(params: DispatchSessionParams): Promise<DispatchSessionResult> {
    const shouldIsolate = params.isolate ?? this.worktreeIsolation
    const planModeSandbox = params.planMode === true
    const shouldCreateWorktree = shouldIsolate || planModeSandbox

    const threadId = this.resolveOrCreateThread(params)
    const sessionId = randomUUID()
    let sessionCreated = false

    try {
      const session = sessionsStore.create({
        id: sessionId,
        projectId: params.projectId,
        agentId: params.agentId,
        model: params.model,
        prompt: params.prompt,
        imageAttachments: params.imageAttachments,
        planMode: params.planMode ?? false,
        spawnedAgent: params.spawnedAgent,
        status: 'running',
        threadId,
      })
      sessionCreated = true

      // Link the thread to the new session and bump updated_at so the sidebar
      // bubbles this thread to the top of its project list.
      const linkedThread = threadsStore.linkSession(threadId, session.id)
      broadcastThreadUpdated(linkedThread)

      this.emitSyntheticEvent(session.id, {
        kind: 'step',
        title: 'Preparing context',
        detail: 'Selecting memory, repository snippets, and recent thread history.',
        status: 'running',
      })
      const contextStartedAt = Date.now()
      const baseContext = await this.resolveDispatchContext(params)
      const context = buildAdapterContext(
        baseContext,
        sessionsStore.listThreadTranscript(threadId, {
          limit: THREAD_CONTEXT_SESSION_LIMIT,
          excludeSessionId: session.id,
        }),
      )
      this.emitSyntheticEvent(session.id, {
        kind: 'step',
        title: 'Context ready',
        detail: `${formatMs(Date.now() - contextStartedAt)} · ${context?.length ?? 0} chars`,
        status: 'done',
      })

      const adapter = this.resolveAdapter(params.agentId)
      if (!adapter) {
        throw new Error(`Adapter not found: ${params.agentId}`)
      }

      let worktreePath: string | null = null
      let localBaseline: LocalChangeBaseline | null = null

      // Plan mode prefers a disposable checkout so planning edits cannot leak
      // back into the user's repo. If the path is not a git checkout, fall
      // back to a local baseline so the plan can still be shown and approved
      // in the test and non-git cases.
      if (shouldCreateWorktree) {
        try {
          worktreePath = await worktreeManager.create(session.id, params.repoPath)
        } catch (error) {
          if (!planModeSandbox || shouldIsolate) throw error

          this.emitSyntheticEvent(session.id, {
            kind: 'step',
            title: 'Plan mode could not create a disposable worktree',
            detail: errorMessage(error),
            status: 'done',
          })
        }
      }

      if (!worktreePath) {
        localBaseline = await captureLocalChangeBaseline(params.repoPath)
      }

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

      promptEvidenceStore.create({
        sessionId: session.id,
        projectId: params.projectId,
        threadId,
        agentId: params.agentId,
        model: params.model,
        prompt: params.prompt,
        resolvedContext: context,
        adapterContext,
      })

      this.emitSyntheticEvent(session.id, {
        kind: 'step',
        title: 'Starting agent process',
        detail: `${params.agentId} · ${params.model}`,
        status: 'running',
      })
      const adapterStartedAt = Date.now()
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
      this.emitSyntheticEvent(session.id, {
        kind: 'step',
        title: 'Agent process started',
        detail: formatMs(Date.now() - adapterStartedAt),
        status: 'done',
      })

      this.activeSessions.set(session.id, {
        approve: () => agentSession.approve(),
        reject: () => agentSession.reject(),
        cancel: () => agentSession.cancel(),
        repoPath: params.repoPath,
        threadId,
        worktreePath,
        localBaseline,
        localTouchedFiles: new Set(),
        sharedLocalRepo: false,
        lastAgentEventAt: Date.now(),
        lastIdleHeartbeatAt: 0,
        qualityAttempt: params.qualityAttempt ?? 0,
        planMode: params.planMode ?? false,
        isolate: shouldIsolate,
        runtimeSettings: params.runtimeSettings,
        baseContext: params.context,
        contextQuery: params.contextQuery,
        prompt: params.prompt,
        agentId: params.agentId,
        modelFallbacks: params.modelFallbacks ?? [],
        imageAttachments: params.imageAttachments,
        adapterContext,
        modelRecoveryMode: params.modelRecoveryMode ?? 'prompt',
      })
      this.markSharedLocalRepoSessions(session.id)
      this.scheduleIdleHeartbeat(session.id)

      agentSession.events.on('event', (event: AgentEvent) => {
        this.handleAgentEvent({ ...event, sessionId: session.id })
      })

      if (params.delegatedTask) {
        this.registerDelegatedTask({
          delegationId: params.delegatedTask.delegationId ?? randomUUID(),
          parentSessionId: params.delegatedTask.parentSessionId,
          childSessionId: session.id,
          childThreadId: threadId,
          goal: params.delegatedTask.goal,
          agentId: params.agentId,
          model: params.model,
        })
      }

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
    this.dropModelRecoveriesForSession(sessionId)
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

  hasActiveRepairSession(): boolean {
    for (const active of this.activeSessions.values()) {
      if (active.qualityAttempt > 0) return true
    }
    return false
  }

  enqueueMessage(
    params: {
      prompt: string
      agentId: AgentId
      model: string
      approvalMode?: AgentApprovalMode
      thinking?: QueuedMessage['thinking']
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
      thinking: params.thinking,
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

  async resolveModelRecovery(
    payload: AgentModelRecoveryDecisionPayload,
    executionOptions: ModelRecoveryExecutionOptions = {},
  ): Promise<DispatchSessionResult | null> {
    const record = this.pendingModelRecoveries.get(payload.recoveryId)
    if (!record) return null
    if (payload.sessionId !== record.sourceSessionId) return null

    if (payload.decision === 'cancel') {
      this.pendingModelRecoveries.delete(payload.recoveryId)
      this.sessionsPausedForUserInput.delete(payload.sessionId)
      sessionsStore.updateStatus(payload.sessionId, 'cancelled')
      this.recordEvent({
        type: 'session-complete',
        sessionId: payload.sessionId,
        payload: { status: 'cancelled' },
        timestamp: Date.now(),
      })
      return null
    }

    if (!payload.agentId || !payload.modelOverride) {
      throw new Error('Choose an agent and model to continue this task')
    }

    executionOptions.validateSelection?.(payload.agentId, payload.modelOverride)

    const execution = await this.dispatch({
      projectId: record.projectId,
      prompt: record.prompt,
      context: record.baseContext,
      contextQuery: record.contextQuery,
      agentId: payload.agentId,
      model: payload.modelOverride,
      modelFallbacks: executionOptions.modelFallbacks,
      repoPath: record.repoPath,
      imageAttachments: record.imageAttachments,
      threadId: record.threadId,
      isolate: record.isolate,
      runtimeSettings: executionOptions.runtimeSettings ?? record.runtimeSettings,
      planMode: record.planMode,
    })
    this.pendingModelRecoveries.delete(payload.recoveryId)
    this.sessionsPausedForUserInput.delete(payload.sessionId)
    return execution
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

  /** Drops pending provider-limit recovery prompts tied to a session. */
  private dropModelRecoveriesForSession(sessionId: string): void {
    for (const [recoveryId, record] of this.pendingModelRecoveries) {
      if (record.sourceSessionId === sessionId) {
        this.pendingModelRecoveries.delete(recoveryId)
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
    this.mirrorDelegatedTaskEvent(event)
    if (event.type === 'activity') {
      if (isAgentActivityPayload(event.payload)) {
        this.noteTouchedFiles(event.sessionId, event.payload)
      }
      this.maybeRunDelegateTask(event)
    }

    const observedProviderLimit = providerLimitReasonFromEvent(event)
    if (observedProviderLimit) {
      const active = this.activeSessions.get(event.sessionId)
      if (active) active.providerLimitReason = observedProviderLimit
    }

    if (event.type === 'activity' && isUserQuestionActivity(event.payload)) {
      if (this.isTerminalSession(event.sessionId)) return

      this.recordEvent(event)
      this.pauseForUserInput(event.sessionId)
      return
    }

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
      const providerLimitReason =
        observedProviderLimit ?? active?.providerLimitReason ?? null

      if (status === 'error' && active && session && providerLimitReason) {
        void this.handleProviderLimitCompletion({
          event: completedEvent,
          active,
          session,
          reason: providerLimitReason,
        })
        return
      }

      this.completeSessionFromEvent(completedEvent, active, session)
      return
    }

    if (event.type === 'error') {
      if (this.isTerminalSession(event.sessionId)) return

      const active = this.activeSessions.get(event.sessionId)
      const session = sessionsStore.get(event.sessionId)
      const providerLimitReason =
        observedProviderLimit ?? active?.providerLimitReason ?? null

      if (active && session && providerLimitReason) {
        void this.handleProviderLimitError(event, active, session, providerLimitReason)
        return
      }

      this.recordSessionErrorEvent(event, active, session)
      return
    }

    if (event.type === 'diff' && isLiveDiffPayload(event.payload)) {
      this.broadcastEvent(event)
      return
    }

    this.recordEvent(event)
    this.recordActivityEvents(event)
  }

  private completeSessionFromEvent(
    event: AgentEvent,
    active: ActiveSession | undefined,
    session: Session | null,
    options: { applyUsage?: boolean } = {},
  ): void {
    const status = completionStatus(event)
    if (options.applyUsage !== false) {
      this.applyUsage(event)
    }
    sessionsStore.updateStatus(event.sessionId, status)
    this.stopIdleHeartbeat(event.sessionId)
    this.stopLiveDiff(event.sessionId)
    this.activeSessions.delete(event.sessionId)
    this.processWarningsBySession.delete(event.sessionId)

    if (active?.planMode) {
      void this.completePlanModeSession(event.sessionId, active, event, session)
      return
    }

    void this.emitCompletionDiffs(event.sessionId, active, event).then(() => {
      this.emitTerminalNotifierEvent(event.sessionId, active, event)

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
  }

  private async handleProviderLimitCompletion(input: {
    event: AgentEvent
    active: ActiveSession
    session: Session
    reason: string
  }): Promise<void> {
    const retried = await this.retryAutoModelRecovery(
      input.event.sessionId,
      input.active,
      input.session,
      input.reason,
    )
    if (retried) {
      return
    }

    if (input.active.modelRecoveryMode === 'auto') {
      this.completeSessionFromEvent(input.event, input.active, input.session)
      return
    }

    this.applyUsage(input.event)
    await this.pauseForModelRecovery(
      input.event.sessionId,
      input.active,
      input.session,
      input.reason,
    )
  }

  private async handleProviderLimitError(
    event: AgentEvent,
    active: ActiveSession,
    session: Session,
    reason: string,
  ): Promise<void> {
    if (await this.retryAutoModelRecovery(event.sessionId, active, session, reason)) {
      return
    }

    if (active.modelRecoveryMode !== 'auto') {
      await this.pauseForModelRecovery(event.sessionId, active, session, reason)
      return
    }

    this.recordEvent({
      type: 'activity',
      sessionId: event.sessionId,
      payload: {
        kind: 'step',
        title: 'Managed swarm model recovery exhausted',
        detail: reason,
        status: 'error',
      },
      timestamp: Date.now(),
    })
    this.recordSessionErrorEvent(event, active, session)
  }

  private async retryAutoModelRecovery(
    sessionId: string,
    active: ActiveSession,
    session: Session,
    reason: string,
  ): Promise<boolean> {
    if (active.modelRecoveryMode !== 'auto') return false

    const nextModel = active.modelFallbacks.find((model) => model && model !== session.model)
    if (!nextModel) return false

    const remainingFallbacks = active.modelFallbacks.filter(
      (model) => model !== nextModel && model !== session.model,
    )
    const adapter = this.resolveAdapter(active.agentId)
    if (!adapter) return false

    active.modelFallbacks = remainingFallbacks
    active.providerLimitReason = undefined
    sessionsStore.updateModel(sessionId, nextModel)
    sessionsStore.updateStatus(sessionId, 'running')
    this.recordEvent({
      type: 'activity',
      sessionId,
      payload: {
        kind: 'step',
        title: 'Model limit reached; switching model',
        detail: `${session.model} hit a provider limit (${reason}). Managed swarm is continuing with ${nextModel}.`,
        status: 'running',
      },
      timestamp: Date.now(),
    })

    try {
      const agentSession = await adapter.dispatch({
        sessionId,
        prompt: active.prompt,
        repoPath: active.worktreePath ?? active.repoPath,
        model: nextModel,
        modelFallbacks: remainingFallbacks,
        context: active.adapterContext ?? undefined,
        imageAttachments: active.imageAttachments,
        runtimeSettings: active.runtimeSettings,
      })

      active.approve = () => agentSession.approve()
      active.reject = () => agentSession.reject()
      active.cancel = () => agentSession.cancel()
      active.lastAgentEventAt = Date.now()
      this.activeSessions.set(sessionId, active)
      this.scheduleIdleHeartbeat(sessionId)

      agentSession.events.on('event', (event: AgentEvent) => {
        this.handleAgentEvent({ ...event, sessionId })
      })
      return true
    } catch (error) {
      this.failSession(sessionId, error)
      return true
    }
  }

  private recordSessionErrorEvent(
    event: AgentEvent,
    active: ActiveSession | undefined,
    session: Session | null,
  ): void {
    sessionsStore.updateStatus(event.sessionId, 'error')
    this.recordEvent(event)
    void this.removeWorktree(event.sessionId, active)
    this.stopIdleHeartbeat(event.sessionId)
    this.stopLiveDiff(event.sessionId)
    if (session && active) {
      this.emitNotifierEvent({
        type: 'session.error',
        sessionId: event.sessionId,
        projectId: session.projectId,
        threadId: active.threadId,
        message: textFromUnknownPayload(event.payload) || 'Session error',
        spawnedAgent: session.spawnedAgent,
      })
    }
    this.activeSessions.delete(event.sessionId)
    this.processWarningsBySession.delete(event.sessionId)
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

  private markSharedLocalRepoSessions(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    if (!active || active.worktreePath || !active.localBaseline) return

    for (const [otherSessionId, other] of this.activeSessions) {
      if (otherSessionId === sessionId) continue
      if (other.worktreePath || !other.localBaseline) continue
      if (other.repoPath !== active.repoPath) continue

      active.sharedLocalRepo = true
      other.sharedLocalRepo = true
    }
  }

  private noteTouchedFiles(sessionId: string, activity: AgentActivity): void {
    const active = this.activeSessions.get(sessionId)
    if (!active?.localBaseline || active.worktreePath) return

    noteTouchedFilesFromActivity(active.localTouchedFiles, active.repoPath, activity)
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

    const stallDuration = now - active.lastAgentEventAt
    if (this.maxStallMs !== false && stallDuration >= this.maxStallMs) {
      const stallSeconds = Math.round(stallDuration / 1000)
      this.recordEvent({
        type: 'activity',
        sessionId,
        payload: {
          kind: 'step',
          title: 'Agent process stalled',
          detail: `No output for ${stallSeconds}s — force-completing the session.`,
          status: 'error',
        },
        timestamp: now,
      })
      this.cancel(sessionId)
      return
    }

    active.lastIdleHeartbeatAt = now
    const idleSeconds = Math.max(1, Math.round(stallDuration / 1000))
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

      this.noteTouchedFiles(activityEvent.sessionId, activityEvent.payload as AgentActivity)
      this.recordEvent(activityEvent)
      if (shouldTriggerLiveLocalDiff(activityEvent)) {
        shouldRefreshLiveDiff = true
      }
      if (isUserQuestionActivity(activityEvent.payload)) {
        shouldPauseForUserInput = true
      }
      this.maybeRunDelegateTask(activityEvent)
    }

    if (shouldPauseForUserInput) {
      this.pauseForUserInput(event.sessionId)
    }

    if (shouldRefreshLiveDiff) {
      this.scheduleLiveLocalDiff(event.sessionId)
    }
  }

  private maybeRunDelegateTask(activityEvent: AgentEvent): void {
    if (!this.delegateTaskRunner) return
    if (!isDelegateTaskToolCall(activityEvent.payload)) return

    const session = sessionsStore.get(activityEvent.sessionId)
    const threadId = session?.threadId ?? this.activeSessions.get(activityEvent.sessionId)?.threadId
    if (!session || !threadId) return
    if (session.spawnedAgent?.kind === 'delegation') return

    const request = delegateTaskRequestFromToolCall(activityEvent.payload)
    if (!request) return

    const requestKey = delegationRequestKey(activityEvent.sessionId, request)
    if (this.processedDelegationRequests.has(requestKey)) return
    this.processedDelegationRequests.add(requestKey)

    void this.delegateTaskRunner({
      parentSessionId: activityEvent.sessionId,
      projectId: session.projectId,
      threadId,
      goal: request.goal,
      context: request.context,
    }).catch((error) => {
      this.recordEvent({
        type: 'activity',
        sessionId: activityEvent.sessionId,
        payload: {
          kind: 'step',
          title: 'Delegated task failed to start',
          detail: errorMessage(error),
          status: 'error',
        },
        timestamp: Date.now(),
      })
    })
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
      const proposals = this.filterLocalDiffProposals(
        active,
        await buildLocalDiffProposals(active.repoPath, active.localBaseline),
      )
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

  private async pauseForModelRecovery(
    sessionId: string,
    active: ActiveSession,
    session: Session,
    reason: string,
  ): Promise<void> {
    sessionsStore.updateStatus(sessionId, 'awaiting-input')
    this.sessionsPausedForUserInput.add(sessionId)
    this.stopIdleHeartbeat(sessionId)
    this.stopLiveDiff(sessionId)
    this.activeSessions.delete(sessionId)
    this.processWarningsBySession.delete(sessionId)

    const recoveryId = randomUUID()
    const requiresImageSupport = (session.imageAttachments?.length ?? 0) > 0
    this.pendingModelRecoveries.set(recoveryId, {
      recoveryId,
      sourceSessionId: sessionId,
      projectId: session.projectId,
      threadId: active.threadId,
      repoPath: active.repoPath,
      prompt: session.prompt,
      agentId: session.agentId,
      model: session.model,
      isolate: active.isolate,
      runtimeSettings: active.runtimeSettings,
      baseContext: active.baseContext,
      contextQuery: active.contextQuery,
      imageAttachments: session.imageAttachments,
      planMode: active.planMode,
      requiresImageSupport,
      reason,
    })

    try {
      await this.removeWorktree(sessionId, active)
    } finally {
      this.recordEvent({
        type: 'activity',
        sessionId,
        payload: {
          kind: 'model-recovery',
          recoveryId,
          failedAgentId: session.agentId,
          failedModel: session.model,
          reason,
          requiresImageSupport,
        },
        timestamp: Date.now(),
      })
    }
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
          ? this.filterLocalDiffProposals(
              active,
              await buildLocalDiffProposals(active.repoPath, active.localBaseline),
            )
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
        const sessionForDiff = sessionsStore.get(sessionId)
        if (sessionForDiff) {
          this.emitNotifierEvent({
            type: 'diff.ready',
            sessionId,
            projectId: sessionForDiff.projectId,
            threadId: active.threadId,
            count: reviewedProposals.length,
            spawnedAgent: sessionForDiff.spawnedAgent,
          })
        }
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
        const status = completionStatus(finalEvent)
        if (status === 'done') {
          await this.runQualityGate(sessionId, active, changedFiles)
        }
        this.recordEvent(finalEvent)
      }
    }
  }

  private filterLocalDiffProposals(
    active: ActiveSession,
    proposals: readonly DiffProposal[],
  ): DiffProposal[] {
    if (!active.sharedLocalRepo) return [...proposals]

    return filterProposalsToTouchedFiles(
      proposals,
      active.repoPath,
      active.localTouchedFiles,
    )
  }

  private emitTerminalNotifierEvent(
    sessionId: string,
    active: ActiveSession | undefined,
    finalEvent: AgentEvent,
  ): void {
    const status = completionStatus(finalEvent)
    if (status !== 'done' && status !== 'error') return

    const completedSession = sessionsStore.get(sessionId)
    const threadId = active?.threadId ?? completedSession?.threadId
    if (!completedSession || !threadId) return

    if (status === 'done') {
      this.emitNotifierEvent({
        type: 'session.done',
        sessionId,
        projectId: completedSession.projectId,
        threadId,
        spawnedAgent: completedSession.spawnedAgent,
      })
      return
    }

    this.emitNotifierEvent({
      type: 'session.error',
      sessionId,
      projectId: completedSession.projectId,
      threadId,
      message: textFromUnknownPayload(finalEvent.payload) || 'Session error',
      spawnedAgent: completedSession.spawnedAgent,
    })
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
    const message = errorMessage(error)
    const event: AgentEvent = {
      type: 'error',
      sessionId,
      payload: { message },
      timestamp: Date.now(),
    }

    sessionsStore.addEvent(event)
    sessionsStore.updateStatus(sessionId, 'error')
    this.broadcastEvent(event)
    this.stopIdleHeartbeat(sessionId)
    const active = this.activeSessions.get(sessionId)
    const session = sessionsStore.get(sessionId)
    const threadId = active?.threadId ?? session?.threadId
    if (session && threadId && (active || session.spawnedAgent)) {
      this.emitNotifierEvent({
        type: 'session.error',
        sessionId,
        projectId: session.projectId,
        threadId,
        message,
        spawnedAgent: session.spawnedAgent,
      })
    }
    this.activeSessions.delete(sessionId)
    this.processWarningsBySession.delete(sessionId)
    this.sessionsPausedForUserInput.delete(sessionId)
    this.dropModelRecoveriesForSession(sessionId)
    this.delegatedTasksByChildSession.delete(sessionId)
  }

  private registerDelegatedTask(record: DelegatedTaskRecord): void {
    this.delegatedTasksByChildSession.set(record.childSessionId, record)
    this.recordDelegationActivity(record, 'running')
  }

  private mirrorDelegatedTaskEvent(event: AgentEvent): void {
    const record = this.delegatedTasksByChildSession.get(event.sessionId)
    if (!record) return

    const lastOutput = delegationOutputFromEvent(event)
    if (lastOutput) {
      record.lastOutput = truncateDelegationText(lastOutput, 500)
    }

    if (event.type === 'session-complete') {
      const status = delegationStatusFromSessionStatus(completionStatus(event))
      this.recordDelegationActivity(record, status, {
        summary: delegationSummary(record.childSessionId, event),
      })
      this.delegatedTasksByChildSession.delete(event.sessionId)
      return
    }

    if (event.type === 'error') {
      const error = textFromUnknownPayload(event.payload).trim()
      this.recordDelegationActivity(record, 'error', {
        error: truncateDelegationText(error || 'Delegated task failed.', 500),
        summary: delegationSummary(record.childSessionId, event),
      })
      this.delegatedTasksByChildSession.delete(event.sessionId)
      return
    }

    if (lastOutput || event.type === 'activity') {
      this.recordDelegationActivity(record, 'running')
    }
  }

  private recordDelegationActivity(
    record: DelegatedTaskRecord,
    status: Extract<AgentActivity, { kind: 'delegation' }>['status'],
    options: { summary?: string; error?: string } = {},
  ): void {
    this.recordEvent({
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

function providerLimitReasonFromEvent(event: AgentEvent): string | null {
  if (
    event.type !== 'stderr' &&
    event.type !== 'error' &&
    event.type !== 'session-complete'
  ) {
    return null
  }

  const text = textFromUnknownPayload(event.payload).trim()
  if (!isProviderLimitText(text)) return null

  return truncateProviderLimitReason(text)
}

function isProviderLimitText(text: string): boolean {
  const normalized = text.toLowerCase()
  if (!normalized) return false

  const directSignals = [
    'usage limit',
    'rate limit',
    'rate_limit',
    'quota',
    'insufficient_quota',
    'too many requests',
    'session limit',
    'model is at capacity',
    'selected model is at capacity',
    'model capacity',
    'capacity exceeded',
    'model is not supported',
    'model is unsupported',
    'model_not_supported',
    'unsupported model',
    'not supported when using',
    'credits exhausted',
    'billing hard limit',
    'credit balance',
    'limit reached',
    'limit exceeded',
  ]

  return directSignals.some((signal) => normalized.includes(signal))
}

function truncateProviderLimitReason(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 500) return normalized

  return `${normalized.slice(0, 497)}...`
}

function textFromUnknownPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (payload === null || payload === undefined) return ''
  if (typeof payload !== 'object') return String(payload)

  const record = payload as Record<string, unknown>
  const directFields = [
    'text',
    'message',
    'error',
    'detail',
    'reason',
    'result',
    'summary',
    'output',
    'content',
  ]

  for (const field of directFields) {
    const value = record[field]
    if (typeof value === 'string' && value.trim()) return value
    if (Array.isArray(value)) {
      const text = value.map(textFromUnknownPayload).join(' ')
      if (text.trim()) return text
    }
    if (value && typeof value === 'object') {
      const text = textFromUnknownPayload(value)
      if (text.trim()) return text
    }
  }

  try {
    return JSON.stringify(payload)
  } catch {
    return String(payload)
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

function isLiveDiffPayload(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'live' in payload &&
    (payload as { live?: unknown }).live === true
  )
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

function isAgentActivityPayload(payload: unknown): payload is AgentActivity {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      typeof (payload as { kind?: unknown }).kind === 'string',
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
  const trimmedBaseContext = baseContext?.trim()
  const historyBlock = buildThreadHistoryBlock(transcript)
  if (!historyBlock) {
    return trimmedBaseContext
      ? truncateForContext(redactSensitiveText(trimmedBaseContext), MAX_ADAPTER_CONTEXT_CHARS)
      : null
  }

  return buildBoundedPromptContext(
    [
      { title: 'Prepared project context:', content: baseContext, maxChars: 18_000 },
      { title: 'Conversation context:', content: historyBlock, maxChars: 6_000 },
    ],
    { maxChars: MAX_ADAPTER_CONTEXT_CHARS },
  )
}

function buildThreadHistoryBlock(transcript: ThreadTranscriptTurn[]): string | null {
  const relevantTurns = transcript.filter(
    (turn) => turn.prompt.trim() || turn.assistantText?.trim(),
  )
  if (relevantTurns.length === 0) return null

  const summaryTurns = relevantTurns.slice(
    0,
    Math.max(0, relevantTurns.length - THREAD_CONTEXT_RECENT_TURNS),
  )
  const recentTurns = relevantTurns.slice(-THREAD_CONTEXT_RECENT_TURNS)
  const sections: string[] = []

  if (summaryTurns.length > 0) {
    sections.push(
      [
        `Older conversation summary (${summaryTurns.length} turn${
          summaryTurns.length === 1 ? '' : 's'
        }):`,
        ...summaryTurns.map(
          (turn, index) =>
            `${index + 1}. User: ${truncateForContext(
              turn.prompt,
              THREAD_CONTEXT_SUMMARY_CHARS,
            )}${
              turn.assistantText?.trim()
                ? `\n   Assistant: ${truncateForContext(
                    turn.assistantText,
                    THREAD_CONTEXT_SUMMARY_CHARS,
                  )}`
                : ''
            }`,
        ),
      ].join('\n'),
    )
  }

  const recent = recentTurns
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

  if (recent.length > 0) {
    sections.push(['Recent conversation turns:', ...recent].join('\n\n'))
  }

  return `Conversation history (same thread, oldest to newest):\n${sections.join('\n\n')}`
}

function formatMs(ms: number): string {
  if (ms < 1_000) return `${ms}ms`
  return `${(ms / 1_000).toFixed(1)}s`
}
