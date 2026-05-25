import { randomUUID } from 'node:crypto'
import {
  SWARM_STRATEGIES,
  type AgentActivity,
  type AppSettings,
  type ImageAttachment,
  type Project,
  type RoutingDecision,
  type SessionStatus,
  type SupportedAgentId,
  type SwarmAgentConfig,
  type SwarmConfig,
  type SwarmResult,
} from '../../shared/types'
import { worktreeManager, type WorktreeManager } from '../git/WorktreeManager'
import { DEFAULT_APP_SETTINGS, settingsService } from '../modules/settings'
import {
  buildManagerPrompt,
  MANAGER_AGENT_ROLE,
  type ManagerPlan,
  parseManagerPlan,
} from '../modules/swarms/domain/managerPrompt'
import { modelRouter } from '../router'
import { capacityFallbackModelsForAgent } from '../router/modelCapacityFallbacks'
import { sessionManager } from '../session'
import { projectsStore, sessionsStore, threadsStore } from '../store'
import { extractSessionOutput } from '../store/sessionOutput'
import type { PlanPromptOutcome } from './planPrompt'
import { askStepApproval } from './stepApprovalPrompt'
import { parseReviewerVerdict, VERDICT_INSTRUCTION } from './reviewVerdict'
import {
  extractSpecContract,
  buildSpecContext,
  PLANNER_SDD_INSTRUCTION,
  IMPLEMENTER_SPEC_INSTRUCTION,
  VERIFIER_SPEC_INSTRUCTION,
  type SpecContract,
} from '../modules/swarms/domain/specContract'

const DEFAULT_REVIEW_LOOP_MAX_ITERATIONS = 3
const REVIEW_LOOP_HARD_CAP = 10
const MANAGED_ORCHESTRATION_HARD_CAP = 8

type MaybePromise<T> = T | Promise<T>

export interface SwarmDispatchInput {
  sessionId: string
  swarmId: string
  strategy: SwarmConfig['strategy']
  threadId: string
  projectId: string
  prompt: string
  role: string
  agentId: SupportedAgentId
  model: string
  repoPath: string
  imageAttachments?: ImageAttachment[]
}

export interface SwarmDispatchResult {
  sessionId?: string
  threadId?: string
  status?: SessionStatus
  output?: string
}

export interface SwarmRouteInput {
  projectId: string
  prompt: string
  preferredAgentId: SupportedAgentId
  modelOverride?: string
  autoAgentSelection?: boolean
}

export interface SwarmPlanConfirmation {
  sessionId: string
  title: string
  options: Array<{ id: string; label: string }>
  allowFreeText?: boolean
  timeoutMs?: number
}

export interface SwarmCreateThreadInput {
  projectId: string
  title: string
}

export interface SwarmCompletionResult {
  status: SessionStatus
  output?: string
}

export interface SwarmCompletionEvent {
  swarmId: string
  threadId: string
  projectId: string
  strategy: SwarmConfig['strategy']
  sessionCount: number
}

export type SwarmCompletionListener = (event: SwarmCompletionEvent) => void

export interface SwarmOrchestratorDependencies {
  getProject?: (projectId: string) => MaybePromise<Pick<Project, 'id' | 'repoPath'> | undefined>
  createThread?: (input: SwarmCreateThreadInput) => MaybePromise<{ id: string }>
  routeModel?: (input: SwarmRouteInput) => MaybePromise<{
    agentId: SupportedAgentId
    model: RoutingDecision['model']
  }>
  dispatchSession?: (input: SwarmDispatchInput) => MaybePromise<SwarmDispatchResult | void>
  waitForSessionCompletion?: (sessionId: string) => MaybePromise<SwarmCompletionResult>
  cancelSession?: (sessionId: string) => MaybePromise<void>
  worktrees?: Pick<WorktreeManager, 'remove'>
  getSettings?: (projectId: string) => MaybePromise<AppSettings>
  /**
   * Optional plan-prompt round-trip for flows that explicitly need an extra
   * confirmation. Manual Swarm Builder launches already confirm intent in the
   * builder UI, so the default must not block on a hidden renderer prompt.
   */
  confirmPlan?: (input: SwarmPlanConfirmation) => MaybePromise<PlanPromptOutcome>
}

type SpawnedSession = SwarmResult['sessions'][number] & {
  output?: string
}

interface ActiveManagedPhase {
  strategy: ManagerPlan['strategy']
  sessions: SpawnedSession[]
  remainingAgents: SwarmAgentConfig[]
}

export class SwarmOrchestrator {
  private readonly swarms = new Map<string, SwarmResult>()
  private dependencies: SwarmOrchestratorDependencies
  private onSwarmComplete: SwarmCompletionListener | undefined

  constructor(dependencies: SwarmOrchestratorDependencies = {}) {
    this.dependencies = {
      worktrees: worktreeManager,
      ...dependencies,
    }
  }

  configure(dependencies: SwarmOrchestratorDependencies): void {
    this.dependencies = {
      ...this.dependencies,
      ...dependencies,
      worktrees: dependencies.worktrees ?? this.dependencies.worktrees ?? worktreeManager,
    }
  }

  setOnSwarmComplete(listener: SwarmCompletionListener | undefined): void {
    this.onSwarmComplete = listener
  }

  private notifyComplete(swarmId: string, projectId: string): void {
    const swarm = this.swarms.get(swarmId)
    if (!swarm) return
    const listener = this.onSwarmComplete
    if (!listener) return
    try {
      listener({
        swarmId,
        threadId: swarm.threadId,
        projectId,
        strategy: swarm.strategy,
        sessionCount: swarm.sessions.length,
      })
    } catch (error) {
      console.error('[SwarmOrchestrator] onSwarmComplete listener threw', error)
    }
  }

  async spawn(config: SwarmConfig): Promise<SwarmResult> {
    const dependencies = this.requireDependencies()
    const project = await dependencies.getProject(config.projectId)
    if (!project) throw new Error(`Project not found: ${config.projectId}`)
    const settings = await dependencies.getSettings(config.projectId)

    validateConfig(config, settings)

    await this.confirmPlanOrThrow(config)

    const threadId =
      config.threadId ??
      (
        await dependencies.createThread({
          projectId: config.projectId,
          title: buildSwarmThreadTitle(config),
        })
      ).id

    const result: SwarmResult = {
      swarmId: randomUUID(),
      threadId,
      strategy: config.strategy,
      sessions: [],
    }

    this.swarms.set(result.swarmId, result)

    if (config.strategy === 'managed') {
      result.sessions = await this.spawnManaged(
        config,
        project.repoPath,
        result.swarmId,
        threadId,
        settings,
      )
    } else if (config.strategy === 'parallel') {
      result.sessions = await this.spawnParallel(config, project.repoPath, result.swarmId, threadId)
      void this.waitForParallelCompletion(result.swarmId, config.projectId, result.sessions)
    } else if (config.strategy === 'sequential') {
      result.sessions = await this.spawnSequential(
        config,
        project.repoPath,
        result.swarmId,
        threadId,
        settings,
      )
      this.injectSwarmFileSummary(result.sessions)
    } else {
      result.sessions = await this.spawnFanOut(config, project.repoPath, result.swarmId, threadId)
      void this.waitForParallelCompletion(result.swarmId, config.projectId, result.sessions)
    }

    return cloneResult(result)
  }

  private async waitForParallelCompletion(
    swarmId: string,
    projectId: string,
    sessions: readonly SpawnedSession[],
  ): Promise<void> {
    await Promise.allSettled(
      sessions.map((session) => Promise.resolve(this.waitForCompletion(session))),
    )
    this.notifyComplete(swarmId, projectId)
  }

  async cancel(swarmId: string): Promise<void> {
    const swarm = this.swarms.get(swarmId)
    if (!swarm) return

    const errors: unknown[] = []
    const cancelSession = this.dependencies.cancelSession
    const worktrees = this.dependencies.worktrees ?? worktreeManager

    for (const session of swarm.sessions) {
      try {
        await cancelSession?.(session.sessionId)
        if (session.worktreePath) {
          await worktrees.remove(session.sessionId)
        }
        session.status = 'cancelled'
      } catch (error) {
        errors.push(error)
      }
    }

    this.swarms.delete(swarmId)

    if (errors.length > 0) {
      throw new Error(`Failed to cancel ${errors.length} swarm session(s)`)
    }
  }

  get(swarmId: string): SwarmResult | undefined {
    const swarm = this.swarms.get(swarmId)
    return swarm ? cloneResult(swarm) : undefined
  }

  list(): SwarmResult[] {
    return [...this.swarms.values()].map(cloneResult)
  }

  private async confirmPlanOrThrow(config: SwarmConfig): Promise<void> {
    const confirm = this.dependencies.confirmPlan
    if (!confirm) return

    const outcome = await confirm({
      sessionId: `swarm-plan-${randomUUID()}`,
      title: 'Implement this plan?',
      options: [
        { id: 'yes', label: 'Yes, implement this plan' },
        { id: 'no', label: 'No, and tell me what to change' },
      ],
      allowFreeText: true,
    })

    if (outcome === 'timeout') {
      throw new Error('Plan prompt timed out before the user responded')
    }
    if (outcome === 'cancelled') {
      throw new Error('Plan prompt was cancelled before the user responded')
    }
    if (outcome.optionId === 'yes') return

    const feedback = outcome.freeText?.trim()
    const suffix = feedback ? `: ${feedback}` : ''
    const error = new Error(`User rejected plan${suffix}`) as Error & {
      code?: string
      freeText?: string
    }
    error.code = 'PLAN_REJECTED'
    if (feedback) error.freeText = feedback
    throw error
  }

  private async spawnParallel(
    config: SwarmConfig,
    repoPath: string,
    swarmId: string,
    threadId: string,
  ): Promise<SpawnedSession[]> {
    return Promise.all(
      config.agents.map((agentConfig) =>
        this.spawnAgent({
          agentConfig,
          swarmStrategy: config.strategy,
          basePrompt: config.prompt,
          projectId: config.projectId,
          repoPath,
          swarmId,
          threadId,
          imageAttachments: config.imageAttachments,
        }),
      ),
    )
  }

  private async spawnSequential(
    config: SwarmConfig,
    repoPath: string,
    swarmId: string,
    threadId: string,
    settings: AppSettings,
  ): Promise<SpawnedSession[]> {
    const [firstAgent, ...remainingAgents] = config.agents
    if (!firstAgent) return []

    const firstSession = await this.spawnAgent({
      agentConfig: firstAgent,
      swarmStrategy: config.strategy,
      basePrompt: config.prompt,
      projectId: config.projectId,
      repoPath,
      swarmId,
      threadId,
      imageAttachments: config.imageAttachments,
    })

    void this.continueSequentialSwarm({
      swarmId,
      threadId,
      projectId: config.projectId,
      repoPath,
      basePrompt: config.prompt,
      maxIterations: clampReviewLoopIterations(
        config.maxIterations,
        settings.swarms.maxReviewerIterations,
      ),
      remainingAgents,
      previousSession: firstSession,
      previousAgentConfig: firstAgent,
    })
      .catch(() => {
        const swarm = this.swarms.get(swarmId)
        const lastSession = swarm?.sessions.at(-1)
        if (lastSession && lastSession.status === 'running') {
          lastSession.status = 'error'
        }
      })
      .finally(() => {
        this.notifyComplete(swarmId, config.projectId)
      })

    return [firstSession]
  }

  private async spawnManaged(
    config: SwarmConfig,
    repoPath: string,
    swarmId: string,
    threadId: string,
    settings: AppSettings,
  ): Promise<SpawnedSession[]> {
    const supportedAgentIds = enabledSwarmAgentIds(settings)
    const managerSession = await this.spawnManagerDecisionSession({
      config,
      repoPath,
      swarmId,
      threadId,
      settings,
      supportedAgentIds,
    })

    this.swarms.get(swarmId)?.sessions.push(managerSession)

    void this.continueManagedFromDecision({
      config,
      repoPath,
      swarmId,
      threadId,
      settings,
      supportedAgentIds,
      managerSession,
      completedPhaseOutputs: [],
      decisionRound: 0,
    })
      .catch(() => {
        const swarm = this.swarms.get(swarmId)
        const lastSession = swarm?.sessions.at(-1)
        if (lastSession) lastSession.status = 'error'
      })
      .finally(() => {
        this.notifyComplete(swarmId, config.projectId)
      })

    return [managerSession]
  }

  private async spawnManagerDecisionSession(input: {
    config: SwarmConfig
    repoPath: string
    swarmId: string
    threadId: string
    settings: AppSettings
    supportedAgentIds: SupportedAgentId[]
    previousOutput?: string
  }): Promise<SpawnedSession> {
    const managerAgentId = selectManagerAgent(input.supportedAgentIds)
    return this.spawnAgent({
      agentConfig: {
        role: MANAGER_AGENT_ROLE,
        agentId: managerAgentId,
        modelOverride: input.settings.agents.modelMap[managerAgentId].frontier,
        promptSuffix: buildManagerPrompt({
          supportedAgentIds: input.supportedAgentIds,
          maxAgents: input.settings.swarms.maxAgents,
        }),
      },
      swarmStrategy: input.config.strategy,
      basePrompt: input.config.prompt,
      projectId: input.config.projectId,
      repoPath: input.repoPath,
      swarmId: input.swarmId,
      threadId: input.threadId,
      previousOutput: input.previousOutput,
      contextLabel: input.previousOutput ? 'Completed swarm work so far' : undefined,
      imageAttachments: input.config.imageAttachments,
    })
  }

  private async resolveManagedDecision(input: {
    swarmId: string
    managerSession: SpawnedSession
    settings: AppSettings
    supportedAgentIds: SupportedAgentId[]
  }): Promise<ManagerPlan> {
    const managerSession = input.managerSession

    const managerCompletion = await this.waitForCompletion(managerSession)
    managerSession.status = managerCompletion.status
    managerSession.output = managerCompletion.output

    if (managerCompletion.status !== 'done') {
      throw new Error('Manager agent failed before producing a plan')
    }

    const plan = parseManagerPlan(managerCompletion.output ?? '', {
      supportedAgentIds: input.supportedAgentIds,
      maxAgents: input.settings.swarms.maxAgents,
    })

    return selectNextManagedPhase(plan)
  }

  private async runManagedDecision(input: {
    config: SwarmConfig
    repoPath: string
    swarmId: string
    threadId: string
    settings: AppSettings
    supportedAgentIds: SupportedAgentId[]
    previousOutput?: string
  }): Promise<ManagerPlan> {
    const managerSession = await this.spawnManagerDecisionSession(input)
    this.swarms.get(input.swarmId)?.sessions.push(managerSession)

    return this.resolveManagedDecision({
      swarmId: input.swarmId,
      managerSession,
      supportedAgentIds: input.supportedAgentIds,
      settings: input.settings,
    })
  }

  private async continueManagedFromDecision(input: {
    config: SwarmConfig
    repoPath: string
    swarmId: string
    threadId: string
    settings: AppSettings
    supportedAgentIds: SupportedAgentId[]
    managerSession: SpawnedSession
    completedPhaseOutputs: string[]
    decisionRound: number
  }): Promise<void> {
    const firstPlan = await this.resolveManagedDecision({
      swarmId: input.swarmId,
      managerSession: input.managerSession,
      supportedAgentIds: input.supportedAgentIds,
      settings: input.settings,
    })

    if (!this.swarms.has(input.swarmId)) return

    const firstPhase = await this.startManagedPhase({
      config: input.config,
      plan: firstPlan,
      repoPath: input.repoPath,
      swarmId: input.swarmId,
      threadId: input.threadId,
      imageAttachments: input.config.imageAttachments,
    })

    if (!firstPhase) return

    await this.continueManagedOrchestration({
      config: input.config,
      repoPath: input.repoPath,
      swarmId: input.swarmId,
      threadId: input.threadId,
      settings: input.settings,
      supportedAgentIds: input.supportedAgentIds,
      activePhase: firstPhase,
      completedPhaseOutputs: input.completedPhaseOutputs,
      decisionRound: input.decisionRound + 1,
    })
  }

  private async startManagedPhase(input: {
    config: SwarmConfig
    plan: ManagerPlan
    repoPath: string
    swarmId: string
    threadId: string
    previousOutput?: string
    imageAttachments?: ImageAttachment[]
    specContract?: SpecContract
  }): Promise<ActiveManagedPhase | null> {
    if (input.plan.status === 'complete') return null

    if (input.plan.strategy === 'parallel') {
      const sessions = await this.spawnParallelWithContext({
        config: {
          ...input.config,
          strategy: 'parallel',
          agents: input.plan.agents,
        },
        repoPath: input.repoPath,
        swarmId: input.swarmId,
        threadId: input.threadId,
        previousOutput: input.previousOutput ?? '',
        contextLabel: 'Manager context for this phase',
        autoAgentSelection: true,
        specContract: input.specContract,
      })

      this.swarms.get(input.swarmId)?.sessions.push(...sessions)
      return { strategy: 'parallel', sessions, remainingAgents: [] }
    }

    const [firstAgent, ...remainingAgents] = input.plan.agents
    if (!firstAgent) return null

    const firstSession = await this.spawnAgent({
      agentConfig: firstAgent,
      swarmStrategy: input.config.strategy,
      basePrompt: input.config.prompt,
      projectId: input.config.projectId,
      repoPath: input.repoPath,
      swarmId: input.swarmId,
      threadId: input.threadId,
      previousOutput: input.previousOutput,
      contextLabel: input.previousOutput ? 'Manager context for this phase' : undefined,
      imageAttachments: input.imageAttachments,
      autoAgentSelection: true,
      specContract: input.specContract,
    })

    this.swarms.get(input.swarmId)?.sessions.push(firstSession)
    return { strategy: 'sequential', sessions: [firstSession], remainingAgents }
  }

  private async continueManagedOrchestration(input: {
    config: SwarmConfig
    swarmId: string
    threadId: string
    repoPath: string
    settings: AppSettings
    supportedAgentIds: SupportedAgentId[]
    activePhase: ActiveManagedPhase
    completedPhaseOutputs: string[]
    decisionRound: number
    specContract?: SpecContract
  }): Promise<void> {
    let activePhase: ActiveManagedPhase | null = input.activePhase
    const completedPhaseOutputs = [...input.completedPhaseOutputs]
    let decisionRound = input.decisionRound
    let specContract: SpecContract | undefined = input.specContract

    while (activePhase) {
      if (!this.swarms.has(input.swarmId)) return

      const completedSessions = await this.completeManagedPhase({
        ...input,
        activePhase,
        specContract,
      })
      if (!completedSessions) return

      const phaseOutput = buildManagedPhaseOutput(completedSessions)
      if (phaseOutput) completedPhaseOutputs.push(phaseOutput)

      if (!specContract) {
        const plannerSession = completedSessions.find((s) => isPlanningRole(s.role))
        if (plannerSession?.output) {
          specContract = extractSpecContract(plannerSession.output) ?? undefined
        }
      }

      if (decisionRound >= MANAGED_ORCHESTRATION_HARD_CAP) return
      decisionRound += 1

      const orchestrationContext = completedPhaseOutputs.join('\n\n')
      const nextPlan = await this.runManagedDecision({
        config: input.config,
        repoPath: input.repoPath,
        swarmId: input.swarmId,
        threadId: input.threadId,
        settings: input.settings,
        supportedAgentIds: input.supportedAgentIds,
        previousOutput: orchestrationContext,
      })

      if (!this.swarms.has(input.swarmId)) return

      activePhase = await this.startManagedPhase({
        config: input.config,
        plan: nextPlan,
        repoPath: input.repoPath,
        swarmId: input.swarmId,
        threadId: input.threadId,
        previousOutput: orchestrationContext,
        imageAttachments: input.config.imageAttachments,
        specContract,
      })
    }
  }

  private async completeManagedPhase(input: {
    swarmId: string
    threadId: string
    repoPath: string
    config: SwarmConfig
    activePhase: ActiveManagedPhase
    specContract?: SpecContract
  }): Promise<SpawnedSession[] | null> {
    if (input.activePhase.strategy === 'parallel') {
      for (const session of input.activePhase.sessions) {
        if (!this.swarms.has(input.swarmId)) return null
        if (session.status === 'done') continue

        const completion = await this.waitForCompletion(session)
        session.status = completion.status
        session.output = completion.output
        if (completion.status !== 'done') return null
      }

      return input.activePhase.sessions
    }

    let previousSession = input.activePhase.sessions.at(-1)
    if (!previousSession) return []
    let previousOutput = previousSession.output ?? ''

    for (const agentConfig of input.activePhase.remainingAgents) {
      if (!this.swarms.has(input.swarmId)) return null

      const completion = await this.waitForCompletion(previousSession)
      previousSession.status = completion.status
      previousSession.output = completion.output
      if (completion.output?.trim()) previousOutput = completion.output
      if (completion.status !== 'done') return null
      if (!this.swarms.has(input.swarmId)) return null

      const nextSession = await this.spawnAgent({
        agentConfig,
        swarmStrategy: input.config.strategy,
        basePrompt: input.config.prompt,
        projectId: input.config.projectId,
        repoPath: input.repoPath,
        swarmId: input.swarmId,
        threadId: input.threadId,
        previousOutput,
        contextLabel: 'Manager context for this phase',
        imageAttachments: input.config.imageAttachments,
        autoAgentSelection: true,
        specContract: input.specContract,
      })

      this.swarms.get(input.swarmId)?.sessions.push(nextSession)
      input.activePhase.sessions.push(nextSession)
      previousSession = nextSession
      previousOutput = nextSession.output ?? previousOutput
    }

    const completion = await this.waitForCompletion(previousSession)
    previousSession.status = completion.status
    previousSession.output = completion.output
    if (completion.status !== 'done') return null

    return input.activePhase.sessions
  }

  private async spawnParallelWithContext(input: {
    config: SwarmConfig
    repoPath: string
    swarmId: string
    threadId: string
    previousOutput: string
    contextLabel: string
    autoAgentSelection?: boolean
    specContract?: SpecContract
  }): Promise<SpawnedSession[]> {
    return Promise.all(
      input.config.agents.map((agentConfig) =>
        this.spawnAgent({
          agentConfig,
          swarmStrategy: input.config.strategy,
          basePrompt: input.config.prompt,
          projectId: input.config.projectId,
          repoPath: input.repoPath,
          swarmId: input.swarmId,
          threadId: input.threadId,
          previousOutput: input.previousOutput,
          contextLabel: input.contextLabel,
          imageAttachments: input.config.imageAttachments,
          autoAgentSelection: input.autoAgentSelection,
          specContract: input.specContract,
        }),
      ),
    )
  }

  private async spawnFanOut(
    config: SwarmConfig,
    repoPath: string,
    swarmId: string,
    threadId: string,
  ): Promise<SpawnedSession[]> {
    return this.spawnParallel(config, repoPath, swarmId, threadId)
  }

  private async runReviewCycle(input: {
    swarmId: string
    threadId: string
    projectId: string
    repoPath: string
    basePrompt: string
    implementerConfig: SwarmAgentConfig
    reviewerConfig: SwarmAgentConfig
    maxIterations: number
    implementerOutput: string
  }): Promise<void> {
    let implementerOutput = input.implementerOutput

    for (let iteration = 1; iteration <= input.maxIterations; iteration += 1) {
      if (!this.swarms.has(input.swarmId)) return

      const reviewer = await this.spawnAgent({
        agentConfig: input.reviewerConfig,
        swarmStrategy: 'sequential',
        basePrompt: input.basePrompt,
        projectId: input.projectId,
        repoPath: input.repoPath,
        swarmId: input.swarmId,
        threadId: input.threadId,
        previousOutput: implementerOutput,
        contextLabel: 'Implementation to review',
        extraInstruction: VERDICT_INSTRUCTION,
      })

      this.swarms.get(input.swarmId)?.sessions.push(reviewer)

      const reviewerCompletion = await this.waitForCompletion(reviewer)
      reviewer.status = reviewerCompletion.status
      if (reviewerCompletion.status !== 'done') return
      if (!this.swarms.has(input.swarmId)) return

      const parsed = parseReviewerVerdict(reviewerCompletion.output)
      if (parsed.verdict === 'approved') return
      if (iteration === input.maxIterations) return

      const implementer = await this.spawnAgent({
        agentConfig: input.implementerConfig,
        swarmStrategy: 'sequential',
        basePrompt: input.basePrompt,
        projectId: input.projectId,
        repoPath: input.repoPath,
        swarmId: input.swarmId,
        threadId: input.threadId,
        previousOutput: parsed.feedback ?? reviewerCompletion.output ?? '',
        contextLabel: 'Reviewer feedback to address',
      })

      this.swarms.get(input.swarmId)?.sessions.push(implementer)

      const implementerCompletion = await this.waitForCompletion(implementer)
      implementer.status = implementerCompletion.status
      if (implementerCompletion.status !== 'done') return

      implementerOutput = implementerCompletion.output ?? implementerOutput
    }
  }

  private async continueSequentialSwarm(input: {
    swarmId: string
    threadId: string
    projectId: string
    repoPath: string
    basePrompt: string
    maxIterations: number
    remainingAgents: SwarmAgentConfig[]
    previousSession: SpawnedSession
    previousAgentConfig: SwarmAgentConfig
  }): Promise<void> {
    let previousSession = input.previousSession
    let previousOutput = previousSession.output ?? ''
    let previousAgentConfig = input.previousAgentConfig
    let specContract: SpecContract | undefined

    for (const agentConfig of input.remainingAgents) {
      if (!this.swarms.has(input.swarmId)) return

      const completion = await this.waitForCompletion(previousSession)
      previousSession.status = completion.status
      if (completion.output?.trim()) previousOutput = completion.output
      if (completion.status !== 'done') return
      if (!this.swarms.has(input.swarmId)) return

      if (!specContract && isPlanningRole(previousAgentConfig.role) && previousOutput) {
        specContract = extractSpecContract(previousOutput) ?? undefined
      }

      let effectiveAgentConfig = agentConfig
      if (previousAgentConfig.requireApprovalAfter) {
        const approval = await askStepApproval({
          sessionId: previousSession.sessionId,
          completedRole: previousAgentConfig.role,
          nextRole: agentConfig.role,
          nextAgentId: agentConfig.agentId,
          nextModel: agentConfig.modelOverride ?? previousSession.model ?? '',
          nextPromptSuffix: agentConfig.promptSuffix,
        })

        if (approval.outcome !== 'continue') return
        if (!this.swarms.has(input.swarmId)) return

        if (approval.editedPromptSuffix || approval.modelOverride) {
          effectiveAgentConfig = {
            ...agentConfig,
            ...(approval.editedPromptSuffix
              ? { promptSuffix: approval.editedPromptSuffix }
              : {}),
            ...(approval.modelOverride
              ? { modelOverride: approval.modelOverride }
              : {}),
          }
        }
      }

      if (isReviewerRole(effectiveAgentConfig.role)) {
        await this.runReviewCycle({
          swarmId: input.swarmId,
          threadId: input.threadId,
          projectId: input.projectId,
          repoPath: input.repoPath,
          basePrompt: input.basePrompt,
          implementerConfig: previousAgentConfig,
          reviewerConfig: effectiveAgentConfig,
          maxIterations: input.maxIterations,
          implementerOutput: previousOutput,
        })
        return
      }

      const nextSession = await this.spawnAgent({
        agentConfig: effectiveAgentConfig,
        swarmStrategy: 'sequential',
        basePrompt: input.basePrompt,
        projectId: input.projectId,
        repoPath: input.repoPath,
        swarmId: input.swarmId,
        threadId: input.threadId,
        previousOutput,
        specContract,
      })

      this.swarms.get(input.swarmId)?.sessions.push(nextSession)
      previousSession = nextSession
      previousAgentConfig = effectiveAgentConfig
      previousOutput = nextSession.output ?? previousOutput
    }

    const completion = await this.waitForCompletion(previousSession)
    previousSession.status = completion.status
  }

  private injectSwarmFileSummary(sessions: SpawnedSession[]): void {
    if (sessions.length <= 1) return
    const lastSession = sessions.at(-1)
    if (!lastSession) return

    // Collect file-change activities from all non-last sessions (implementers).
    // Deduplicates by filePath so the last session to touch a file wins.
    type FileChangePayload = Extract<AgentActivity, { kind: 'file-change' }>
    const fileChanges = new Map<string, FileChangePayload>()

    for (const session of sessions.slice(0, -1)) {
      for (const event of sessionsStore.listEvents(session.sessionId)) {
        if (event.type !== 'activity') continue
        const payload = event.payload as AgentActivity
        if (!payload || typeof payload !== 'object') continue
        if (payload.kind !== 'file-change') continue
        fileChanges.set(payload.filePath, payload)
      }
    }

    if (fileChanges.size === 0) return

    // Persist synthetic file-change activities into the last session's event log.
    // groupTurns treats file-change as a post-completion artifact so these will
    // stay in the reviewer's final turn and render as EditedFilesCard.
    const baseTimestamp = Date.now()
    let i = 0
    for (const payload of fileChanges.values()) {
      sessionsStore.addEvent({
        type: 'activity',
        sessionId: lastSession.sessionId,
        payload,
        timestamp: baseTimestamp + i,
      })
      i += 1
    }
  }

  private async spawnAgent(input: {
    agentConfig: SwarmAgentConfig
    swarmStrategy: SwarmConfig['strategy']
    basePrompt: string
    projectId: string
    repoPath: string
    swarmId: string
    threadId: string
    previousOutput?: string
    contextLabel?: string
    extraInstruction?: string
    imageAttachments?: ImageAttachment[]
    autoAgentSelection?: boolean
    specContract?: SpecContract
  }): Promise<SpawnedSession> {
    const dependencies = this.requireDependencies()
    const provisionalSessionId = randomUUID()
    const prompt = buildAgentPrompt(
      input.basePrompt,
      input.agentConfig,
      input.previousOutput,
      {
        contextLabel: input.contextLabel,
        extraInstruction: input.extraInstruction,
        specContract: input.specContract,
      },
    )

    const decision = await dependencies.routeModel({
      projectId: input.projectId,
      prompt,
      preferredAgentId: input.agentConfig.agentId,
      modelOverride: input.agentConfig.modelOverride,
      autoAgentSelection: input.autoAgentSelection,
    })

    const dispatchResult = await dependencies.dispatchSession({
      sessionId: provisionalSessionId,
      swarmId: input.swarmId,
      strategy: input.swarmStrategy,
      threadId: input.threadId,
      projectId: input.projectId,
      prompt,
      role: input.agentConfig.role,
      agentId: decision.agentId,
      model: decision.model,
      repoPath: input.repoPath,
      imageAttachments: input.imageAttachments,
    })

    return {
      sessionId: dispatchResult?.sessionId ?? provisionalSessionId,
      threadId: dispatchResult?.threadId ?? input.threadId,
      role: input.agentConfig.role,
      worktreePath: null,
      status: dispatchResult?.status ?? 'running',
      agentId: decision.agentId,
      model: decision.model,
      output: dispatchResult?.output,
    }
  }

  private async waitForCompletion(session: SpawnedSession): Promise<SwarmCompletionResult> {
    const wait = this.dependencies.waitForSessionCompletion
    if (!wait) {
      return {
        status: session.output?.trim() ? 'done' : normalizeCompletionStatus(session.status),
        output: session.output,
      }
    }

    return wait(session.sessionId)
  }

  private requireDependencies(): Required<
    Omit<SwarmOrchestratorDependencies, 'confirmPlan'>
  > & Pick<SwarmOrchestratorDependencies, 'confirmPlan'> {
    const { getProject, createThread, routeModel, dispatchSession } = this.dependencies

    if (!getProject || !createThread || !routeModel || !dispatchSession) {
      throw new Error(
        'SwarmOrchestrator dependencies are not configured. Wire project lookup, thread creation, model routing, and session dispatch before spawning swarms.',
      )
    }

    return {
      getProject,
      createThread,
      routeModel,
      dispatchSession,
      waitForSessionCompletion:
        this.dependencies.waitForSessionCompletion ?? (() => ({ status: 'running' })),
      cancelSession: this.dependencies.cancelSession ?? (() => undefined),
      worktrees: this.dependencies.worktrees ?? worktreeManager,
      getSettings: this.dependencies.getSettings ?? (() => DEFAULT_APP_SETTINGS),
      confirmPlan: this.dependencies.confirmPlan,
    }
  }
}

function validateConfig(config: SwarmConfig, settings: AppSettings): void {
  if (!config.projectId.trim()) throw new Error('Swarm projectId is required')
  if (config.threadId !== undefined && !config.threadId.trim()) {
    throw new Error('Swarm threadId must be a non-empty string when provided')
  }
  if (!config.prompt.trim()) throw new Error('Swarm prompt is required')
  if (!SWARM_STRATEGIES.includes(config.strategy)) {
    throw new Error(`Unsupported swarm strategy: ${config.strategy}`)
  }
  if (config.strategy === 'managed') return

  if (config.agents.length === 0) throw new Error('At least one swarm agent is required')
  if (config.agents.length > settings.swarms.maxAgents) {
    throw new Error(`Swarm agent limit is ${settings.swarms.maxAgents}`)
  }

  for (const [index, agent] of config.agents.entries()) {
    if (!agent.role.trim()) throw new Error(`Agent ${index + 1} role is required`)
  }
}

function buildSwarmThreadTitle(config: SwarmConfig): string {
  const prefix =
    config.strategy === 'managed'
      ? 'Managed swarm'
      : config.strategy === 'sequential'
        ? 'Sequential swarm'
        : 'Swarm'
  const prompt = config.prompt.trim()
  const title = prompt ? `${prefix}: ${prompt}` : prefix
  return title.slice(0, 200)
}

function selectManagerAgent(agentIds: readonly SupportedAgentId[]): SupportedAgentId {
  for (const preferred of ['codex', 'claude-code', 'antigravity', 'opencode'] as const) {
    if (agentIds.includes(preferred)) return preferred
  }

  return agentIds[0] ?? 'claude-code'
}

function enabledSwarmAgentIds(settings: AppSettings): SupportedAgentId[] {
  return settings.agents.enabledAgentIds.length > 0
    ? [...settings.agents.enabledAgentIds]
    : [DEFAULT_APP_SETTINGS.agents.defaultAgentId]
}

function isReviewerRole(role: string): boolean {
  return /\breview/i.test(role)
}

function selectNextManagedPhase(plan: ManagerPlan): ManagerPlan {
  if (plan.status === 'complete') return plan
  if (plan.agents.length <= 1) return plan

  const [firstAgent] = plan.agents
  if (firstAgent && isPlanningRole(firstAgent.role)) {
    return {
      ...plan,
      strategy: 'sequential',
      agents: [firstAgent],
    }
  }

  const firstVerificationIndex = plan.agents.findIndex((agent) => isVerificationRole(agent.role))
  if (firstVerificationIndex > 0) {
    return {
      ...plan,
      agents: plan.agents.slice(0, firstVerificationIndex),
    }
  }

  return plan
}

function isPlanningRole(role: string): boolean {
  return /\b(plan|planner|planning|architect|design|scope|research|analy)/i.test(role)
}

function isVerificationRole(role: string): boolean {
  const normalized = role.toLowerCase()
  if (isImplementationRole(normalized)) return false

  return /\b(review|reviewer|critic|test|tester|qa|quality assurance|verif|validat)/i.test(
    normalized,
  )
}

function isImplementationRole(role: string): boolean {
  return /\b(implement\w*|builder|build|coder|developer|engineer)\b/i.test(role)
}

function buildManagedPhaseOutput(sessions: readonly SpawnedSession[]): string {
  return sessions
    .map((session) => {
      const output = session.output?.trim()
      if (!output) return ''
      return `[${session.role}]\n${output}`
    })
    .filter(Boolean)
    .join('\n\n')
}

function buildAgentPrompt(
  basePrompt: string,
  agentConfig: SwarmAgentConfig,
  previousOutput?: string,
  options?: { contextLabel?: string; extraInstruction?: string; specContract?: SpecContract },
): string {
  const role = agentConfig.role
  const lines = [`[Role: ${role}]`]

  if (isPlanningRole(role)) {
    lines.push(PLANNER_SDD_INSTRUCTION)
  } else if (options?.specContract) {
    lines.push('', buildSpecContext(options.specContract))
    if (isImplementationRole(role)) {
      lines.push(IMPLEMENTER_SPEC_INSTRUCTION)
    } else if (isVerificationRole(role)) {
      lines.push(VERIFIER_SPEC_INSTRUCTION)
    }
  }

  lines.push('', basePrompt.trim())

  if (previousOutput?.trim()) {
    const label = options?.contextLabel ?? 'Context from previous step'
    lines.push('', `${label}:`, previousOutput.trim())
  }

  if (agentConfig.promptSuffix?.trim()) {
    lines.push('', agentConfig.promptSuffix.trim())
  }

  if (options?.extraInstruction?.trim()) {
    lines.push('', options.extraInstruction.trim())
  }

  return lines.join('\n')
}

function clampReviewLoopIterations(
  value: number | undefined,
  defaultMaxIterations = DEFAULT_REVIEW_LOOP_MAX_ITERATIONS,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultMaxIterations
  }
  const rounded = Math.floor(value)
  if (rounded < 1) return 1
  if (rounded > REVIEW_LOOP_HARD_CAP) return REVIEW_LOOP_HARD_CAP
  return rounded
}

function normalizeCompletionStatus(status: SessionStatus | string): SessionStatus {
  if (
    status === 'running' ||
    status === 'awaiting-approval' ||
    status === 'awaiting-input' ||
    status === 'done' ||
    status === 'error' ||
    status === 'cancelled'
  ) {
    return status
  }

  return 'running'
}

function cloneResult(result: SwarmResult): SwarmResult {
  return {
    ...result,
    sessions: result.sessions.map((session) => ({ ...session })),
  }
}

async function waitForStoredSessionCompletion(
  sessionId: string,
): Promise<SwarmCompletionResult> {
  for (;;) {
    const session = sessionsStore.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const events = sessionsStore.listEvents(sessionId)
    const terminalEvent = events.find(
      (event) => event.type === 'session-complete' || event.type === 'error',
    )

    if (session.status === 'awaiting-input') {
      return { status: 'awaiting-input', output: extractSessionOutput(events) }
    }

    if (session.status === 'cancelled') {
      return { status: 'cancelled', output: extractSessionOutput(events) }
    }

    if (terminalEvent && isTerminalStatus(session.status)) {
      return { status: session.status, output: extractSessionOutput(events) }
    }

    await delay(750)
  }
}

function isTerminalStatus(status: SessionStatus): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createDefaultDependencies(): SwarmOrchestratorDependencies {
  return {
    getProject: (projectId) => projectsStore.get(projectId) ?? undefined,
    createThread: (input) => threadsStore.create(input),
    routeModel: (input) => modelRouter.route(input),
    dispatchSession: async (input) => {
      const settings = settingsService.getEffective(input.projectId).settings
      const { sessionId, threadId } = await sessionManager.dispatch({
        projectId: input.projectId,
        threadId: input.threadId,
        prompt: input.prompt,
        agentId: input.agentId,
        model: input.model,
        modelFallbacks: capacityFallbackModelsForAgent({
          settings,
          agentId: input.agentId,
          currentModel: input.model,
          requiresImageSupport: (input.imageAttachments?.length ?? 0) > 0,
        }),
        repoPath: input.repoPath,
        context: projectsStore.getContext(input.projectId),
        isolate: settings.execution.worktreeIsolation,
        runtimeSettings: settings.agents.runtimes[input.agentId],
        modelRecoveryMode: input.strategy === 'managed' ? 'auto' : 'prompt',
      })

      return { sessionId, threadId, status: 'running' }
    },
    waitForSessionCompletion: waitForStoredSessionCompletion,
    cancelSession: (sessionId) => sessionManager.cancel(sessionId),
    worktrees: worktreeManager,
    getSettings: (projectId) => settingsService.getEffective(projectId).settings,
  }
}

export const swarmOrchestrator = new SwarmOrchestrator(createDefaultDependencies())
