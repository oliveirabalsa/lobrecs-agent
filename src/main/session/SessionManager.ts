import type { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import type {
  AgentActivity,
  AgentApprovalMode,
  AgentEvent,
  AgentId,
  AgentModelRecoveryDecisionPayload,
  AgentPlanReviewDecisionPayload,
  AgentRuntimeSettings,
  QueuedMessage,
  Session,
  SpawnedAgentSession,
  SupportedAgentId,
  Thread,
  ThreadUpdatedEvent,
} from '../../shared/types'
import { isImageAttachment } from '../../shared/types'
import { processWarningKey } from '../../shared/contracts/agentOutput'
import { worktreeManager } from '../git/WorktreeManager'
import { applyDiffContent } from '../modules/diffs/application/applyDiff'
import { runGit } from '../modules/git/infrastructure/runGit'
import { validateBranchName } from '../modules/git/application/gitWorkspaceService'
import { parseStatusPorcelain } from '../modules/git/domain/gitWorkspaceParsers'
import { projectsStore, promptEvidenceStore, sessionsStore, threadsStore } from '../store'
import { deriveActivityEvents } from './activity'
import { buildPlanExecutionPrompt, buildPlanModeContext } from './planModePrompt'
import { captureLocalChangeBaseline, type LocalChangeBaseline } from './localDiff'
import { buildDiffProposals } from './worktreeDiff'
import { filterProposalsToTouchedFiles } from './fileTouchTracking'
import type { DiffProposal, ImageAttachment } from '../../shared/types'
import type {
  BringThreadToLocalInput,
  CreateBranchHereInput,
  GitChangedFile,
  GitFileEntry,
  MoveThreadToWorktreeInput,
  WorktreeDiffPreview,
  WorktreeHandoffRequest,
  WorktreeHandoffState,
} from '../../shared/contracts/git'
import { SessionDispatchBootstrapService } from '../modules/sessions/application/sessionDispatchBootstrapService'
import {
  SessionLivenessService,
  shouldTriggerLiveLocalDiff,
} from '../modules/sessions/application/sessionLivenessService'
import { SessionCompletionService } from '../modules/sessions/application/sessionCompletionService'
import { SessionQueueService } from '../modules/sessions/application/sessionQueueService'
import { SessionRecoveryDelegationService } from '../modules/sessions/application/sessionRecoveryDelegationService'
import {
  TERMINAL_SESSION_STATUSES,
  isUserQuestionActivity,
  type ActiveSession,
  type DelegatedTaskRecord,
  type ModelRecoveryRecord,
  type PendingQueuedMessage,
  type PlanReviewRecord,
} from '../modules/sessions/application/sessionWorkflowTypes'
import {
  completionStatus,
  errorMessage,
  objectPayload,
  readNumber,
  textFromUnknownPayload,
  withCompletionStatus,
} from '../modules/sessions/application/sessionWorkflowUtils'

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
  /**
   * Return after the durable session/thread exists, while context resolution and
   * process startup continue asynchronously. Used by the interactive composer so
   * the user's message can render immediately.
   */
  returnAfterSessionCreated?: boolean
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
  planMode?: boolean
}) => Promise<string | null>
export type SessionPromptDecorator = (input: {
  projectId: string
  repoPath: string
  threadId: string
  sessionId: string
  prompt: string
  agentId: AgentId
}) => Promise<string>
export type SessionRetryGate = (input: {
  projectId: string
  repoPath: string
  threadId: string
  sessionId: string
  reason: string
  nextModel?: string
}) => Promise<{ allow: boolean; reason?: string }>
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

export type ModelRecoveryExecutionOptions = {
  runtimeSettings?: AgentRuntimeSettings
  modelFallbacks?: string[]
  validateSelection?: (agentId: SupportedAgentId, model: string) => void
}

export type SessionManagerOptions = {
  adapters?: Iterable<AgentAdapter>
  adapterResolver?: AdapterResolver
  broadcast?: EventBroadcaster
  estimateCost?: CostEstimator
  worktreeIsolation?: boolean
  resolveContext?: SessionContextResolver
  decoratePrompt?: SessionPromptDecorator
  gateRetry?: SessionRetryGate
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
  private readonly completedDelegationsByParentSession = new Map<string, DelegatedTaskRecord[]>()
  private readonly queuedDelegationHandoffs = new Set<string>()
  private readonly processedDelegationRequests = new Set<string>()
  private estimateCost: CostEstimator
  private resolveContext?: SessionContextResolver
  private decoratePrompt?: SessionPromptDecorator
  private gateRetry?: SessionRetryGate
  private qualityGateRunner?: QualityGateRunner
  private delegateTaskRunner?: DelegateTaskRunner
  private notifier?: NotifierCallback
  private readonly idleHeartbeatMs: number | false
  private readonly maxStallMs: number | false
  private readonly dispatchBootstrapService: SessionDispatchBootstrapService
  private readonly livenessService: SessionLivenessService
  private readonly completionService: SessionCompletionService
  private readonly queueService: SessionQueueService
  private readonly recoveryDelegationService: SessionRecoveryDelegationService

  constructor(options: SessionManagerOptions = {}) {
    this.adapterResolver = options.adapterResolver
    this.broadcastEvent = options.broadcast ?? broadcastToRenderer
    this.worktreeIsolation = options.worktreeIsolation ?? false
    this.estimateCost = options.estimateCost ?? (() => 0)
    this.resolveContext = options.resolveContext
    this.decoratePrompt = options.decoratePrompt
    this.gateRetry = options.gateRetry
    this.qualityGateRunner = options.qualityGateRunner
    this.delegateTaskRunner = options.delegateTaskRunner
    this.notifier = options.notifier
    this.idleHeartbeatMs = options.idleHeartbeatMs ?? 45_000
    this.maxStallMs = options.maxStallMs ?? 300_000
    this.dispatchBootstrapService = new SessionDispatchBootstrapService({
      broadcastThreadUpdated,
      getContextResolver: () => this.resolveContext,
    })
    this.livenessService = new SessionLivenessService({
      activeSessions: this.activeSessions,
      idleHeartbeatMs: this.idleHeartbeatMs,
      maxStallMs: this.maxStallMs,
      recordEvent: (event) => this.recordEvent(event),
      cancel: (sessionId) => this.cancel(sessionId),
      handleAgentEvent: (event) => this.handleAgentEvent(event),
      filterLocalDiffProposals: (active, proposals) =>
        this.filterLocalDiffProposals(active, proposals),
    })
    this.completionService = new SessionCompletionService({
      getCostEstimator: () => this.estimateCost,
      getQualityGateRunner: () => this.qualityGateRunner,
      recordEvent: (event) => this.recordEvent(event),
      handleAgentEvent: (event) => this.handleAgentEvent(event),
      emitNotifierEvent: (event) => this.emitNotifierEvent(event),
      stopLiveDiff: (sessionId) => this.stopLiveDiff(sessionId),
      filterLocalDiffProposals: (active, proposals) =>
        this.filterLocalDiffProposals(active, proposals),
    })
    this.queueService = new SessionQueueService({
      activeSessions: this.activeSessions,
      pendingQueues: this.pendingQueues,
      dispatch: (params) => this.dispatch(params),
    })
    this.recoveryDelegationService = new SessionRecoveryDelegationService({
      delegatedTasksByChildSession: this.delegatedTasksByChildSession,
      processedDelegationRequests: this.processedDelegationRequests,
      getDelegateTaskRunner: () => this.delegateTaskRunner,
      getThreadId: (sessionId) => this.activeSessions.get(sessionId)?.threadId,
      recordEvent: (event) => this.recordEvent(event),
    })

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

  setPromptDecorator(decoratePrompt: SessionPromptDecorator | undefined): void {
    this.decoratePrompt = decoratePrompt
  }

  setRetryGate(gateRetry: SessionRetryGate | undefined): void {
    this.gateRetry = gateRetry
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

    const threadId = this.dispatchBootstrapService.resolveOrCreateThread(params)
    const persistentThreadWorktreePath = planModeSandbox
      ? null
      : worktreeManager.getThreadWorktreePath(threadId) ?? null
    const shouldCreateWorktree = !persistentThreadWorktreePath && (shouldIsolate || planModeSandbox)
    const sessionId = randomUUID()
    let sessionCreated = false
    let startupCancelled = false

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

      // Link only user-facing sessions to the thread. Spawned background
      // sessions have their own output surfaces and must not replace the
      // visible parent/finalizer session as `last_session_id`.
      if (!params.spawnedAgent) {
        const linkedThread = threadsStore.linkSession(threadId, session.id)
        broadcastThreadUpdated(linkedThread)
      } else {
        const thread = threadsStore.get(threadId)
        if (thread) broadcastThreadUpdated(thread)
      }

      this.activeSessions.set(session.id, {
        approve: () => undefined,
        reject: () => undefined,
        cancel: () => {
          startupCancelled = true
        },
        repoPath: params.repoPath,
        threadId,
        worktreePath: persistentThreadWorktreePath,
        persistentWorktree: Boolean(persistentThreadWorktreePath),
        localBaseline: null,
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
        modelRecoveryMode: params.modelRecoveryMode ?? 'prompt',
      })

      const startup = this.startDispatchedSession({
        params,
        session,
        threadId,
        shouldIsolate,
        shouldCreateWorktree,
        persistentThreadWorktreePath,
        isStartupCancelled: () => startupCancelled,
      }).catch(async (error: unknown) => {
        if (!persistentThreadWorktreePath) {
          await worktreeManager.remove(session.id, params.repoPath)
        }
        if (!this.isTerminalSession(session.id)) {
          this.failSession(session.id, error)
        }
        if (!params.returnAfterSessionCreated) throw error
      })

      if (params.returnAfterSessionCreated) {
        void startup
        return { sessionId: session.id, threadId }
      }

      await startup
      return { sessionId: session.id, threadId }
    } catch (error) {
      if (!persistentThreadWorktreePath) {
        await worktreeManager.remove(sessionId, params.repoPath)
      }
      if (sessionCreated && !this.isTerminalSession(sessionId)) {
        this.failSession(sessionId, error)
      }
      throw error
    }
  }

  private async startDispatchedSession({
    params,
    session,
    threadId,
    shouldIsolate,
    shouldCreateWorktree,
    persistentThreadWorktreePath,
    isStartupCancelled,
  }: {
    params: DispatchSessionParams
    session: Session
    threadId: string
    shouldIsolate: boolean
    shouldCreateWorktree: boolean
    persistentThreadWorktreePath: string | null
    isStartupCancelled: () => boolean
  }): Promise<void> {
    const planModeSandbox = params.planMode === true
    const hasStartupCancelled = (): boolean =>
      isStartupCancelled() || this.isTerminalSession(session.id)

    const cleanupIfCancelled = async (): Promise<boolean> => {
      if (!hasStartupCancelled()) return false
      if (!persistentThreadWorktreePath) {
        await worktreeManager.remove(session.id, params.repoPath)
      }
      return true
    }

    const contextStepTitle = params.planMode
      ? 'Investigating repository for plan mode'
      : 'Preparing context'
    const contextStepDetail = params.planMode
      ? 'Building current file structure, symbols, memory, and relevant snippets before planning.'
      : 'Selecting memory, repository snippets, and recent thread history.'

    this.emitSyntheticEvent(session.id, {
      kind: 'step',
      title: contextStepTitle,
      detail: contextStepDetail,
      status: 'running',
    })
    const contextStartedAt = Date.now()
    const baseContext = await this.dispatchBootstrapService.resolveDispatchContext(params)
    if (await cleanupIfCancelled()) return
    const context = this.dispatchBootstrapService.buildAdapterContext(
      baseContext,
      threadId,
      session.id,
    )
    this.emitSyntheticEvent(session.id, {
      kind: 'step',
      title: params.planMode ? 'Plan-mode investigation ready' : 'Context ready',
      detail: `${formatMs(Date.now() - contextStartedAt)} · ${context?.length ?? 0} chars`,
      status: 'done',
    })

    const adapter = this.resolveAdapter(params.agentId)
    if (!adapter) {
      throw new Error(`Adapter not found: ${params.agentId}`)
    }

      let worktreePath: string | null = persistentThreadWorktreePath
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
      if (await cleanupIfCancelled()) return

      if (worktreePath) {
        this.emitSyntheticEvent(session.id, {
          kind: 'step',
          title: persistentThreadWorktreePath
            ? 'Using thread worktree'
            : 'Created isolated worktree',
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
      const adapterPrompt = await this.decorateAdapterPrompt({
        projectId: params.projectId,
        repoPath: params.repoPath,
        threadId,
        sessionId: session.id,
        prompt: params.prompt,
        agentId: params.agentId,
      })

      promptEvidenceStore.create({
        sessionId: session.id,
        projectId: params.projectId,
        threadId,
        agentId: params.agentId,
        model: params.model,
        prompt: adapterPrompt,
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
        prompt: adapterPrompt,
        repoPath: worktreePath ?? params.repoPath,
        model: params.model,
        modelFallbacks: params.modelFallbacks,
        context: adapterContext,
        imageAttachments: params.imageAttachments,
        runtimeSettings: params.runtimeSettings,
      })
      if (await cleanupIfCancelled()) {
        agentSession.cancel()
        return
      }
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
        persistentWorktree: Boolean(persistentThreadWorktreePath),
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
        prompt: adapterPrompt,
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
  }

  approve(sessionId: string): void {
    this.activeSessions.get(sessionId)?.approve()
    const session = sessionsStore.get(sessionId)
    if (session?.status === 'awaiting-approval') {
      sessionsStore.updateStatus(sessionId, 'running')
      this.noteAgentEvent(sessionId)
    }
  }

  private async decorateAdapterPrompt(input: {
    projectId: string
    repoPath: string
    threadId: string
    sessionId: string
    prompt: string
    agentId: AgentId
  }): Promise<string> {
    if (!this.decoratePrompt) return input.prompt
    try {
      const decorated = await this.decoratePrompt(input)
      return decorated.trim() ? decorated : input.prompt
    } catch (error) {
      this.emitSyntheticEvent(input.sessionId, {
        kind: 'step',
        title: 'Extension prompt hook skipped',
        detail: errorMessage(error),
        status: 'error',
      })
      return input.prompt
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
    this.clearBlockingState(sessionId)
    const session = sessionsStore.get(sessionId)

    if (session && !TERMINAL_SESSION_STATUSES.has(session.status)) {
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
    if (!active?.persistentWorktree) {
      void worktreeManager.remove(sessionId, active?.repoPath)
    }
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
      profileId?: QueuedMessage['profileId']
      approvalMode?: AgentApprovalMode
      thinking?: QueuedMessage['thinking']
      runtimeSettings?: AgentRuntimeSettings
    },
    threadId: string,
  ): QueuedMessage {
    return this.queueService.enqueueMessage(params, threadId)
  }

  getQueue(threadId: string): QueuedMessage[] {
    return this.queueService.getQueue(threadId)
  }

  removeQueueItem(threadId: string, messageId: string): void {
    this.queueService.removeQueueItem(threadId, messageId)
  }

  clearQueue(threadId: string): void {
    this.queueService.clearQueue(threadId)
  }

  async getWorktreeHandoffState(
    input: WorktreeHandoffRequest,
    repoPath: string,
  ): Promise<WorktreeHandoffState> {
    this.assertThreadProject(input)
    return this.buildWorktreeHandoffState(input, repoPath)
  }

  async moveThreadToWorktree(
    input: MoveThreadToWorktreeInput,
    repoPath: string,
  ): Promise<WorktreeHandoffState> {
    this.assertThreadProject(input)
    if (this.isThreadBusy(input.threadId)) {
      throw new Error('Move to worktree is only available when this thread is idle.')
    }

    await worktreeManager.createThreadWorktree({
      projectId: input.projectId,
      threadId: input.threadId,
      repoPath,
      cleanupPolicy: input.cleanupPolicy,
    })
    return this.buildWorktreeHandoffState(input, repoPath, 'move-to-worktree')
  }

  async previewWorktreeHandoff(
    input: WorktreeHandoffRequest,
    repoPath: string,
  ): Promise<WorktreeDiffPreview> {
    this.assertThreadProject(input)
    const metadata = worktreeManager.getThreadWorktree(input.threadId)
    const targetPath = metadata?.worktreePath ?? repoPath
    const [status, diff, localDirty] = await Promise.all([
      runGit(['status', '--porcelain=v1', '--untracked-files=all'], targetPath),
      runGit(['diff', '--patch', '--binary', 'HEAD'], targetPath),
      this.hasLocalChanges(repoPath),
    ])
    const parsedStatus = status.exitCode === 0 ? parseStatusPorcelain(status.stdout) : null
    const changedFiles = parsedStatus ? gitChangedFiles(parsedStatus.files) : []

    return {
      projectId: input.projectId,
      threadId: input.threadId,
      location: metadata?.location ?? 'local',
      worktreePath: metadata?.worktreePath,
      branch: metadata?.branch,
      baseBranch: metadata?.baseBranch,
      baseCommit: metadata?.baseCommit,
      snapshotStatus: metadata?.snapshotStatus ?? (changedFiles.length > 0 ? 'dirty' : 'clean'),
      cleanupPolicy: metadata?.cleanupPolicy ?? 'manual',
      changedFiles,
      patch: diff.exitCode === 0 ? diff.stdout : '',
      hasLocalChanges: localDirty,
      hasConflicts: parsedStatus?.files.some((file) => file.conflict) ?? false,
    }
  }

  async bringThreadToLocal(
    input: BringThreadToLocalInput,
    repoPath: string,
  ): Promise<WorktreeHandoffState> {
    this.assertThreadProject(input)
    if (this.isThreadBusy(input.threadId)) {
      throw new Error('Bring to local is only available when this thread is idle.')
    }

    const metadata = worktreeManager.getThreadWorktree(input.threadId)
    if (!metadata?.worktreePath) {
      return this.buildWorktreeHandoffState(input, repoPath, 'bring-to-local')
    }

    if (await this.hasLocalChanges(repoPath)) {
      return this.buildWorktreeHandoffState(input, repoPath, 'bring-to-local')
    }

    const proposals = await buildDiffProposals(metadata.worktreePath, repoPath)
    for (const proposal of proposals) {
      await applyDiffContent(
        proposal.filePath,
        proposal.proposedContent,
        proposal.originalContent,
      )
    }

    if (
      input.removeAfterApply === true ||
      metadata.cleanupPolicy === 'remove-after-bring-back'
    ) {
      await worktreeManager.removeThread(input.threadId, repoPath)
    } else {
      await worktreeManager.refreshThreadSnapshotStatus(input.threadId)
    }

    return this.buildWorktreeHandoffState(input, repoPath, 'bring-to-local')
  }

  async createBranchHere(
    input: CreateBranchHereInput,
    repoPath: string,
  ): Promise<WorktreeHandoffState> {
    this.assertThreadProject(input)
    if (this.isThreadBusy(input.threadId)) {
      throw new Error('Create branch here is only available when this thread is idle.')
    }

    const branchName = await validateBranchName(input.branchName, repoPath)
    const metadata = worktreeManager.getThreadWorktree(input.threadId)
    if (metadata?.worktreePath) {
      await worktreeManager.createBranchForThread(input.threadId, branchName)
    } else {
      const result = await runGit(['switch', '-c', branchName], repoPath)
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || 'Failed to create branch.')
      }
    }

    return this.buildWorktreeHandoffState(input, repoPath, 'create-branch-here')
  }

  async restoreWorktreeSnapshot(
    input: WorktreeHandoffRequest,
    repoPath: string,
  ): Promise<WorktreeHandoffState> {
    this.assertThreadProject(input)
    if (this.isThreadBusy(input.threadId)) {
      throw new Error('Restore snapshot is only available when this thread is idle.')
    }

    await worktreeManager.restoreThreadSnapshot(input.threadId)
    return this.buildWorktreeHandoffState(input, repoPath, 'restore-snapshot')
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

  private assertThreadProject(input: WorktreeHandoffRequest): void {
    const thread = threadsStore.get(input.threadId)
    if (!thread || thread.projectId !== input.projectId) {
      throw new Error('Thread does not belong to this project.')
    }
  }

  private async buildWorktreeHandoffState(
    input: WorktreeHandoffRequest,
    repoPath: string,
    command?: WorktreeHandoffState['command'],
  ): Promise<WorktreeHandoffState> {
    const metadata = worktreeManager.getThreadWorktree(input.threadId)
    if (metadata?.worktreePath) {
      const [snapshotStatus, worktreeChanges, localChanges] = await Promise.all([
        worktreeManager.refreshThreadSnapshotStatus(input.threadId),
        this.changedFileCount(metadata.worktreePath),
        this.changedFileCount(repoPath),
      ])

      return {
        ...metadata,
        command,
        snapshotStatus: snapshotStatus ?? metadata.snapshotStatus,
        pendingChangeCount: worktreeChanges,
        hasLocalChanges: localChanges > 0,
        hasWorktreeChanges: worktreeChanges > 0,
        conflictCheck: localChanges > 0 ? 'local-dirty' : 'clean',
      }
    }

    const localChanges = await this.changedFileCount(repoPath)
    return {
      projectId: input.projectId,
      threadId: input.threadId,
      location: 'local',
      snapshotStatus: localChanges > 0 ? 'dirty' : 'clean',
      cleanupPolicy: 'manual',
      updatedAt: Date.now(),
      command,
      pendingChangeCount: localChanges,
      hasLocalChanges: localChanges > 0,
      hasWorktreeChanges: false,
      conflictCheck: 'clean',
    }
  }

  private async changedFileCount(repoPath: string): Promise<number> {
    const status = await runGit(['status', '--porcelain=v1', '--untracked-files=all'], repoPath)
    if (status.exitCode !== 0) return 0
    return status.stdout.split(/\r?\n/).filter((line) => line.trim()).length
  }

  private async hasLocalChanges(repoPath: string): Promise<boolean> {
    return (await this.changedFileCount(repoPath)) > 0
  }

  private resolveAdapter(agentId: AgentId): AgentAdapter | undefined {
    return this.adapterResolver?.(agentId) ?? this.adapters.get(agentId)
  }

  private async resolveDispatchContext(
    params: DispatchSessionParams,
  ): Promise<string | null | undefined> {
    return this.dispatchBootstrapService.resolveDispatchContext(params)
  }

  private resolveOrCreateThread(params: DispatchSessionParams): string {
    return this.dispatchBootstrapService.resolveOrCreateThread(params)
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
    this.clearBlockingState(event.sessionId)

    if (active?.planMode) {
      void this.completePlanModeSession(event.sessionId, active, event, session)
      return
    }

    void this.emitCompletionDiffs(event.sessionId, active, event).then(() => {
      if (!sessionsStore.get(event.sessionId)) return

      this.queueDelegationHandoffIfReady(event.sessionId)
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
    }).catch((error: unknown) => {
      console.error(
        `[session] completion finalization failed for ${event.sessionId}:`,
        errorMessage(error),
      )
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
    if (!(await this.isRetryAllowed(sessionId, active, session, reason, nextModel))) return false

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
        title: 'Model unavailable; switching model',
        detail: `${session.model} failed (${reason}). Continuing with ${nextModel}.`,
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

  private async isRetryAllowed(
    sessionId: string,
    active: ActiveSession,
    session: Session,
    reason: string,
    nextModel: string,
  ): Promise<boolean> {
    if (!this.gateRetry) return true
    try {
      const result = await this.gateRetry({
        projectId: session.projectId,
        repoPath: active.repoPath,
        threadId: active.threadId,
        sessionId,
        reason,
        nextModel,
      })
      if (result.allow) return true
      this.recordEvent({
        type: 'activity',
        sessionId,
        payload: {
          kind: 'step',
          title: 'Model retry blocked',
          detail: result.reason ?? 'An extension retry gate blocked the retry.',
          status: 'error',
        },
        timestamp: Date.now(),
      })
      return false
    } catch (error) {
      this.recordEvent({
        type: 'activity',
        sessionId,
        payload: {
          kind: 'step',
          title: 'Model retry blocked',
          detail: `Extension retry gate failed: ${errorMessage(error)}`,
          status: 'error',
        },
        timestamp: Date.now(),
      })
      return false
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
    this.clearBlockingState(event.sessionId)
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
  }

  private recordEvent(event: AgentEvent): void {
    sessionsStore.addEvent(event)
    this.broadcastEvent(event)
  }

  private noteAgentEvent(sessionId: string): void {
    this.livenessService.noteAgentEvent(sessionId)
  }

  private markSharedLocalRepoSessions(sessionId: string): void {
    this.livenessService.markSharedLocalRepoSessions(sessionId)
  }

  private noteTouchedFiles(sessionId: string, activity: AgentActivity): void {
    this.livenessService.noteTouchedFiles(sessionId, activity)
  }

  private scheduleIdleHeartbeat(sessionId: string): void {
    this.livenessService.scheduleIdleHeartbeat(sessionId)
  }

  private emitIdleHeartbeat(sessionId: string): void {
    this.livenessService.emitIdleHeartbeat(sessionId)
  }

  private stopIdleHeartbeat(sessionId: string): void {
    this.livenessService.stopIdleHeartbeat(sessionId)
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
    this.recoveryDelegationService.maybeRunDelegateTask(activityEvent)
  }

  private scheduleLiveLocalDiff(sessionId: string): void {
    this.livenessService.scheduleLiveLocalDiff(sessionId)
  }

  private stopLiveDiff(sessionId: string): void {
    this.livenessService.stopLiveDiff(sessionId)
  }

  private async emitLiveLocalDiff(sessionId: string): Promise<void> {
    await this.livenessService.emitLiveLocalDiff(sessionId)
  }

  private pauseForUserInput(sessionId: string): void {
    const session = sessionsStore.get(sessionId)
    if (!session || TERMINAL_SESSION_STATUSES.has(session.status)) return

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
    const requiresImageSupport = (session.imageAttachments ?? []).some(isImageAttachment)
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
    return session ? TERMINAL_SESSION_STATUSES.has(session.status) : false
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
    await this.completionService.emitCompletionDiffs(sessionId, active, finalEvent)
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
    this.completionService.emitTerminalNotifierEvent(sessionId, active, finalEvent)
  }

  private async runQualityGate(
    sessionId: string,
    active: ActiveSession,
    changedFiles: DiffProposal[],
  ): Promise<void> {
    await this.completionService.runQualityGate(sessionId, active, changedFiles)
  }

  private async applyDiffProposals(
    sessionId: string,
    proposals: DiffProposal[],
  ): Promise<DiffProposal[]> {
    return this.completionService.applyDiffProposals(sessionId, proposals)
  }

  private async removeWorktree(
    sessionId: string,
    active = this.activeSessions.get(sessionId),
  ): Promise<void> {
    await this.completionService.removeWorktree(sessionId, active)
  }

  private applyUsage(event: AgentEvent): void {
    this.completionService.applyUsage(event)
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
    return this.queueService.isThreadBusy(threadId)
  }

  private async dispatchNextQueued(
    threadId: string,
    fallback: { projectId: string; repoPath: string },
  ): Promise<void> {
    await this.queueService.dispatchNextQueued(threadId, fallback)
  }

  private clearBlockingState(sessionId: string): void {
    this.stopIdleHeartbeat(sessionId)
    this.stopLiveDiff(sessionId)
    this.activeSessions.delete(sessionId)
    this.processWarningsBySession.delete(sessionId)
    this.sessionsPausedForUserInput.delete(sessionId)
    this.dropPlanReviewsForSession(sessionId)
    this.dropModelRecoveriesForSession(sessionId)
    this.delegatedTasksByChildSession.delete(sessionId)
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
    void this.removeWorktree(sessionId, active)
    this.clearBlockingState(sessionId)
  }

  private registerDelegatedTask(record: DelegatedTaskRecord): void {
    this.recoveryDelegationService.registerDelegatedTask(record)
  }

  private mirrorDelegatedTaskEvent(event: AgentEvent): void {
    const result = this.recoveryDelegationService.mirrorDelegatedTaskEvent(event)
    if (!result) return

    const completed = this.completedDelegationsByParentSession.get(result.record.parentSessionId) ?? []
    this.completedDelegationsByParentSession.set(result.record.parentSessionId, [
      ...completed,
      result.record,
    ])
    this.queueDelegationHandoffIfReady(result.record.parentSessionId)
  }

  private queueDelegationHandoffIfReady(parentSessionId: string): void {
    if (this.queuedDelegationHandoffs.has(parentSessionId)) return

    const completed = this.completedDelegationsByParentSession.get(parentSessionId)
    if (!completed?.length) return
    if (this.hasActiveDelegationsForParent(parentSessionId)) return

    const parentSession = sessionsStore.get(parentSessionId)
    if (!parentSession?.threadId) return
    if (parentSession.status !== 'done') return
    if (parentSession.spawnedAgent) return

    const project = projectsStore.get(parentSession.projectId)
    if (!project) {
      this.recordEvent({
        type: 'activity',
        sessionId: parentSessionId,
        payload: {
          kind: 'step',
          title: 'Background handoff could not start',
          detail: `Project not found: ${parentSession.projectId}`,
          status: 'error',
        },
        timestamp: Date.now(),
      })
      return
    }

    this.queuedDelegationHandoffs.add(parentSessionId)
    this.completedDelegationsByParentSession.delete(parentSessionId)
    this.enqueueMessage(
      {
        prompt: buildDelegationHandoffPrompt(completed),
        agentId: parentSession.agentId,
        model: parentSession.model,
      },
      parentSession.threadId,
    )

    if (!this.isThreadBusy(parentSession.threadId)) {
      void this.dispatchNextQueued(parentSession.threadId, {
        projectId: parentSession.projectId,
        repoPath: project.repoPath,
      })
    }
  }

  private hasActiveDelegationsForParent(parentSessionId: string): boolean {
    for (const record of this.delegatedTasksByChildSession.values()) {
      if (record.parentSessionId === parentSessionId) return true
    }
    return false
  }

}

export const sessionManager = new SessionManager()

function buildDelegationHandoffPrompt(records: readonly DelegatedTaskRecord[]): string {
  const sections = records.map(formatDelegatedTaskRecord).join('\n\n---\n\n')
  return truncateDelegationHandoffPrompt(
    [
      '[Background agent handoff]',
      '',
      'Background agents for the previous user request have finished.',
      'Continue the main thread now.',
      '',
      'Required response:',
      '- Review the background outputs and edited files below.',
      '- If implementation is still incomplete, make the remaining code changes.',
      '- Tell the user what happened, which files changed, and what verification was run or is still needed.',
      '- Do not delegate again unless there is genuinely new independent work.',
      '',
      'Background agent results:',
      sections,
    ].join('\n'),
  )
}

function formatDelegatedTaskRecord(record: DelegatedTaskRecord): string {
  const events = sessionsStore.listEvents(record.childSessionId)
  const editedFiles = delegatedTaskEditedFiles(events)
  const transcript = events
    .map(formatDelegatedTaskEvent)
    .filter((line) => line.trim().length > 0)
    .join('\n')

  return [
    `Goal: ${record.goal}`,
    `Child session: ${record.childSessionId}`,
    `Agent: ${record.agentId} / ${record.model}`,
    `Status: ${record.status ?? 'done'}`,
    record.summary ? `Summary: ${record.summary}` : null,
    record.error ? `Error: ${record.error}` : null,
    editedFiles.length > 0 ? `Edited files:\n${editedFiles.map((file) => `- ${file}`).join('\n')}` : 'Edited files: none recorded',
    transcript ? `Full output:\n${transcript}` : 'Full output: no recorded output',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

function delegatedTaskEditedFiles(events: readonly AgentEvent[]): string[] {
  const files = new Map<string, string>()

  for (const event of events) {
    if (event.type === 'activity' && isAgentActivityPayload(event.payload)) {
      const activity = event.payload
      if (activity.kind === 'file-change') {
        files.set(
          activity.filePath,
          `${activity.filePath} (${activity.changeType}, ${activity.status})`,
        )
      }
    }

    if (event.type !== 'diff' || !Array.isArray(event.payload)) continue
    for (const item of event.payload) {
      if (!item || typeof item !== 'object') continue
      const proposal = item as Partial<DiffProposal>
      if (!proposal.filePath) continue
      files.set(
        proposal.filePath,
        `${proposal.filePath} (${proposal.status ?? 'changed'}, +${proposal.additions ?? 0}/-${proposal.deletions ?? 0})`,
      )
    }
  }

  return [...files.values()]
}

function formatDelegatedTaskEvent(event: AgentEvent): string {
  const prefix = new Date(event.timestamp).toISOString()

  if (event.type === 'activity' && isAgentActivityPayload(event.payload)) {
    const text = formatDelegatedTaskActivity(event.payload)
    return text ? `[${prefix}] ${text}` : ''
  }

  if (event.type === 'diff') {
    const files = delegatedTaskEditedFiles([event])
    return files.length > 0 ? `[${prefix}] Diff: ${files.join('; ')}` : ''
  }

  if (event.type === 'session-complete') {
    return `[${prefix}] Session completed: ${completionStatus(event)}`
  }

  const text = textFromUnknownPayload(event.payload).trim()
  return text ? `[${prefix}] ${event.type}: ${text}` : ''
}

function formatDelegatedTaskActivity(activity: AgentActivity): string {
  switch (activity.kind) {
    case 'message':
      return `${activity.role}: ${activity.text}`
    case 'step':
      return [activity.title, activity.detail].filter(Boolean).join(' - ')
    case 'tool-call':
      return `Tool call: ${activity.name}`
    case 'tool-result':
      return `Tool result: ${activity.name}${activity.output ? `\n${activity.output}` : ''}`
    case 'command':
      return `Command: ${activity.command} (${activity.status})`
    case 'file-change':
      return `File changed: ${activity.filePath} (${activity.changeType}, ${activity.status})`
    case 'diff-summary':
      return `Diff summary: ${activity.summary}`
    case 'completion':
      return `Completion: ${activity.summary}`
    case 'approval':
      return `Approval: ${activity.status}`
    case 'compaction':
      return 'Context automatically compacted'
    case 'plan-prompt':
      return `Plan prompt: ${activity.title}`
    case 'plan-review':
      return 'Plan review requested'
    case 'user-question':
      return `User question: ${activity.title}`
    case 'swarm-step-approval':
      return `Swarm approval: ${activity.completedRole} -> ${activity.nextRole}`
    case 'model-recovery':
      return `Model recovery: ${activity.failedAgentId} / ${activity.failedModel}`
    case 'delegation':
      return `Delegation: ${activity.goal} (${activity.status})`
    case 'multitask-plan':
      return `Multitask plan: ${activity.tasks.length} tasks`
    case 'todo-list':
      return `Todo list: ${activity.items.map((item) => `${item.completed ? '[x]' : '[ ]'} ${item.text}`).join('; ')}`
  }
}

function truncateDelegationHandoffPrompt(prompt: string): string {
  const maxLength = 120_000
  if (prompt.length <= maxLength) return prompt
  return `${prompt.slice(0, maxLength - 120)}\n\n[Background handoff truncated to fit the agent context.]`
}

function processWarningActivityKey(event: AgentEvent): string | null {
  if (event.type !== 'activity') return null
  if (!isProcessWarningPayload(event.payload)) return null

  return processWarningKey(event.payload.detail)
}

function gitChangedFiles(files: readonly GitFileEntry[]): GitChangedFile[] {
  return files.map((file) => ({
    path: file.path,
    previousPath: file.previousPath,
    status: gitChangedFileStatus(file.status),
  }))
}

function gitChangedFileStatus(status: GitFileEntry['status']): GitChangedFile['status'] {
  if (
    status === 'added' ||
    status === 'modified' ||
    status === 'deleted' ||
    status === 'renamed' ||
    status === 'copied' ||
    status === 'untracked' ||
    status === 'type-changed'
  ) {
    return status
  }

  return 'modified'
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
  if (!isProviderLimitText(text) && !hasRecoverableProviderStatus(event.payload)) return null

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
    'model not found',
    'model_not_found',
    'model does not exist',
    'model not available',
    'model unavailable',
    'unknown model',
    'invalid model',
    'unsupported model',
    'not supported when using',
    '404 page not found',
    '404 not found',
    'status code 404',
    'statuscode":404',
    'credits exhausted',
    'billing hard limit',
    'credit balance',
    'limit reached',
    'limit exceeded',
  ]

  return directSignals.some((signal) => normalized.includes(signal))
}

function hasRecoverableProviderStatus(payload: unknown, depth = 0): boolean {
  if (!payload || typeof payload !== 'object' || depth > 4) return false

  const record = payload as Record<string, unknown>
  for (const field of ['statusCode', 'status', 'httpStatus']) {
    const status = numberLike(record[field])
    if (status && isRecoverableProviderStatus(status)) return true
  }

  return Object.values(record).some((value) => hasRecoverableProviderStatus(value, depth + 1))
}

function numberLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isRecoverableProviderStatus(status: number): boolean {
  return (
    status === 404 ||
    status === 408 ||
    status === 409 ||
    status === 422 ||
    status === 429 ||
    status >= 500
  )
}

function truncateProviderLimitReason(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 500) return normalized

  return `${normalized.slice(0, 497)}...`
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

function formatMs(ms: number): string {
  if (ms < 1_000) return `${ms}ms`
  return `${(ms / 1_000).toFixed(1)}s`
}
