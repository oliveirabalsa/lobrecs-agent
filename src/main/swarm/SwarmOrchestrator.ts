import { randomUUID } from 'node:crypto'
import type {
  Project,
  RoutingDecision,
  SessionStatus,
  SupportedAgentId,
  SwarmAgentConfig,
  SwarmConfig,
  SwarmResult,
} from '../../shared/types'
import { worktreeManager, type WorktreeManager } from '../git/WorktreeManager'
import { modelRouter } from '../router'
import { sessionManager } from '../session'
import { projectsStore, sessionsStore, threadsStore } from '../store'
import type { PlanPromptOutcome } from './planPrompt'

type MaybePromise<T> = T | Promise<T>

export interface SwarmDispatchInput {
  sessionId: string
  swarmId: string
  threadId: string
  projectId: string
  prompt: string
  role: string
  agentId: SupportedAgentId
  model: string
  repoPath: string
  imageAttachments?: Array<{ id: string; name?: string; mimeType: string; dataUrl: string; size: number }>
}

export interface SwarmDispatchResult {
  sessionId?: string
  threadId?: string
  status?: SessionStatus
  output?: string
}

export interface SwarmRouteInput {
  prompt: string
  preferredAgentId: SupportedAgentId
  modelOverride?: string
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
  worktrees?: Pick<WorktreeManager, 'create' | 'remove' | 'reassignSession'>
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

export class SwarmOrchestrator {
  private readonly swarms = new Map<string, SwarmResult>()
  private dependencies: SwarmOrchestratorDependencies

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

  async spawn(config: SwarmConfig): Promise<SwarmResult> {
    validateConfig(config)

    const dependencies = this.requireDependencies()
    const project = await dependencies.getProject(config.projectId)
    if (!project) throw new Error(`Project not found: ${config.projectId}`)

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

    if (config.strategy === 'parallel') {
      result.sessions = await this.spawnParallel(config, project.repoPath, result.swarmId, threadId)
    } else if (config.strategy === 'sequential') {
      result.sessions = await this.spawnSequential(config, project.repoPath, result.swarmId, threadId)
    } else {
      result.sessions = await this.spawnFanOut(config, project.repoPath, result.swarmId, threadId)
    }

    return cloneResult(result)
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
        await worktrees.remove(session.sessionId)
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
          basePrompt: config.prompt,
          projectId: config.projectId,
          repoPath,
          swarmId,
          threadId,
        }),
      ),
    )
  }

  private async spawnSequential(
    config: SwarmConfig,
    repoPath: string,
    swarmId: string,
    threadId: string,
  ): Promise<SpawnedSession[]> {
    const [firstAgent, ...remainingAgents] = config.agents
    if (!firstAgent) return []

    const firstSession = await this.spawnAgent({
      agentConfig: firstAgent,
      basePrompt: config.prompt,
      projectId: config.projectId,
      repoPath,
      swarmId,
      threadId,
    })

    void this.continueSequentialSwarm({
      swarmId,
      threadId,
      projectId: config.projectId,
      repoPath,
      basePrompt: config.prompt,
      remainingAgents,
      previousSession: firstSession,
    }).catch(() => {
      const swarm = this.swarms.get(swarmId)
      const lastSession = swarm?.sessions.at(-1)
      if (lastSession && lastSession.status === 'running') {
        lastSession.status = 'error'
      }
    })

    return [firstSession]
  }

  private async spawnFanOut(
    config: SwarmConfig,
    repoPath: string,
    swarmId: string,
    threadId: string,
  ): Promise<SpawnedSession[]> {
    return this.spawnParallel(config, repoPath, swarmId, threadId)
  }

  private async continueSequentialSwarm(input: {
    swarmId: string
    threadId: string
    projectId: string
    repoPath: string
    basePrompt: string
    remainingAgents: SwarmAgentConfig[]
    previousSession: SpawnedSession
  }): Promise<void> {
    let previousSession = input.previousSession
    let previousOutput = previousSession.output ?? ''

    for (const agentConfig of input.remainingAgents) {
      if (!this.swarms.has(input.swarmId)) return

      const completion = await this.waitForCompletion(previousSession)
      previousSession.status = completion.status
      if (completion.output?.trim()) previousOutput = completion.output
      if (completion.status !== 'done') return
      if (!this.swarms.has(input.swarmId)) return

      const nextSession = await this.spawnAgent({
        agentConfig,
        basePrompt: input.basePrompt,
        projectId: input.projectId,
        repoPath: input.repoPath,
        swarmId: input.swarmId,
        threadId: input.threadId,
        previousOutput,
      })

      this.swarms.get(input.swarmId)?.sessions.push(nextSession)
      previousSession = nextSession
      previousOutput = nextSession.output ?? previousOutput
    }

    const completion = await this.waitForCompletion(previousSession)
    previousSession.status = completion.status
  }

  private async spawnAgent(input: {
    agentConfig: SwarmAgentConfig
    basePrompt: string
    projectId: string
    repoPath: string
    swarmId: string
    threadId: string
    previousOutput?: string
    imageAttachments?: Array<{ id: string; name?: string; mimeType: string; dataUrl: string; size: number }>
  }): Promise<SpawnedSession> {
    const dependencies = this.requireDependencies()
    const provisionalSessionId = randomUUID()
    const worktreePath = await dependencies.worktrees.create(provisionalSessionId, input.repoPath)
    const prompt = buildAgentPrompt(
      input.basePrompt,
      input.agentConfig,
      input.previousOutput,
    )

    try {
      const decision = await dependencies.routeModel({
        prompt,
        preferredAgentId: input.agentConfig.agentId,
        modelOverride: input.agentConfig.modelOverride,
      })

      const dispatchResult = await dependencies.dispatchSession({
        sessionId: provisionalSessionId,
        swarmId: input.swarmId,
        threadId: input.threadId,
        projectId: input.projectId,
        prompt,
        role: input.agentConfig.role,
        agentId: decision.agentId,
        model: decision.model,
        repoPath: worktreePath,
        imageAttachments: input.imageAttachments,
      })

      const actualSessionId = dispatchResult?.sessionId ?? provisionalSessionId
      if (actualSessionId !== provisionalSessionId) {
        dependencies.worktrees.reassignSession(provisionalSessionId, actualSessionId)
      }

      return {
        sessionId: actualSessionId,
        threadId: dispatchResult?.threadId ?? input.threadId,
        role: input.agentConfig.role,
        worktreePath,
        status: dispatchResult?.status ?? 'running',
        agentId: decision.agentId,
        model: decision.model,
        output: dispatchResult?.output,
      }
    } catch (error) {
      await dependencies.worktrees.remove(provisionalSessionId)
      throw error
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
      confirmPlan: this.dependencies.confirmPlan,
    }
  }
}

function validateConfig(config: SwarmConfig): void {
  if (!config.projectId.trim()) throw new Error('Swarm projectId is required')
  if (config.threadId !== undefined && !config.threadId.trim()) {
    throw new Error('Swarm threadId must be a non-empty string when provided')
  }
  if (!config.prompt.trim()) throw new Error('Swarm prompt is required')
  if (!['parallel', 'sequential', 'fan-out'].includes(config.strategy)) {
    throw new Error(`Unsupported swarm strategy: ${config.strategy}`)
  }
  if (config.agents.length === 0) throw new Error('At least one swarm agent is required')
  if (config.agents.length > 8) throw new Error('Swarm agent limit is 8')

  for (const [index, agent] of config.agents.entries()) {
    if (!agent.role.trim()) throw new Error(`Agent ${index + 1} role is required`)
  }
}

function buildSwarmThreadTitle(config: SwarmConfig): string {
  const prefix = config.strategy === 'sequential' ? 'Sequential swarm' : 'Swarm'
  const prompt = config.prompt.trim()
  const title = prompt ? `${prefix}: ${prompt}` : prefix
  return title.slice(0, 200)
}

function buildAgentPrompt(
  basePrompt: string,
  agentConfig: SwarmAgentConfig,
  previousOutput?: string,
): string {
  const lines = [`[Role: ${agentConfig.role}]`, basePrompt.trim()]

  if (previousOutput?.trim()) {
    lines.push('', 'Context from previous step:', previousOutput.trim())
  }

  if (agentConfig.promptSuffix?.trim()) {
    lines.push('', agentConfig.promptSuffix.trim())
  }

  return lines.join('\n')
}

function normalizeCompletionStatus(status: SessionStatus | string): SessionStatus {
  if (
    status === 'running' ||
    status === 'awaiting-approval' ||
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

    if (session.status === 'cancelled') {
      return { status: 'cancelled', output: extractSessionOutput(events) }
    }

    if (terminalEvent && isTerminalStatus(session.status)) {
      return { status: session.status, output: extractSessionOutput(events) }
    }

    await delay(750)
  }
}

function extractSessionOutput(
  events: ReturnType<typeof sessionsStore.listEvents>,
): string | undefined {
  const assistantMessages = events
    .filter((event) => event.type === 'activity')
    .map((event) => assistantMessageText(event.payload))
    .filter((text): text is string => Boolean(text?.trim()))

  const assistantOutput = lastNonEmpty(assistantMessages)
  if (assistantOutput) return assistantOutput

  const stdoutMessages = events
    .filter((event) => event.type === 'stdout')
    .map((event) => textFromPayload(event.payload))
    .filter((text) => text.trim())

  return lastNonEmpty(stdoutMessages)
}

function assistantMessageText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  return record.kind === 'message' &&
    record.role === 'assistant' &&
    typeof record.text === 'string'
    ? record.text
    : undefined
}

function textFromPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (!payload || typeof payload !== 'object') return ''

  const record = payload as Record<string, unknown>
  for (const key of ['text', 'result', 'message', 'content', 'summary', 'output']) {
    const value = record[key]
    if (typeof value === 'string') return value
  }

  return ''
}

function lastNonEmpty(values: string[]): string | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const text = values[index].trim()
    if (text) return text
  }

  return undefined
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
      const { sessionId, threadId } = await sessionManager.dispatch({
        projectId: input.projectId,
        threadId: input.threadId,
        prompt: input.prompt,
        agentId: input.agentId,
        model: input.model,
        repoPath: input.repoPath,
        context: projectsStore.getContext(input.projectId),
        isolate: false,
      })

      return { sessionId, threadId, status: 'running' }
    },
    waitForSessionCompletion: waitForStoredSessionCompletion,
    cancelSession: (sessionId) => sessionManager.cancel(sessionId),
    worktrees: worktreeManager,
  }
}

export const swarmOrchestrator = new SwarmOrchestrator(createDefaultDependencies())
