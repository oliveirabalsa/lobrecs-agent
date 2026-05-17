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
import { projectsStore } from '../store'

type MaybePromise<T> = T | Promise<T>

export interface SwarmDispatchInput {
  sessionId: string
  swarmId: string
  projectId: string
  prompt: string
  role: string
  agentId: SupportedAgentId
  model: string
  repoPath: string
}

export interface SwarmDispatchResult {
  sessionId?: string
  status?: SessionStatus
  output?: string
}

export interface SwarmRouteInput {
  prompt: string
  preferredAgentId: SupportedAgentId
  modelOverride?: string
}

export interface SwarmOrchestratorDependencies {
  getProject?: (projectId: string) => MaybePromise<Pick<Project, 'id' | 'repoPath'> | undefined>
  routeModel?: (input: SwarmRouteInput) => MaybePromise<{
    agentId: SupportedAgentId
    model: RoutingDecision['model']
  }>
  dispatchSession?: (input: SwarmDispatchInput) => MaybePromise<SwarmDispatchResult | void>
  cancelSession?: (sessionId: string) => MaybePromise<void>
  worktrees?: Pick<WorktreeManager, 'create' | 'remove' | 'reassignSession'>
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

    const result: SwarmResult = {
      swarmId: randomUUID(),
      strategy: config.strategy,
      sessions: [],
    }

    this.swarms.set(result.swarmId, result)

    if (config.strategy === 'parallel') {
      result.sessions = await this.spawnParallel(config, project.repoPath, result.swarmId)
    } else if (config.strategy === 'sequential') {
      result.sessions = await this.spawnSequential(config, project.repoPath, result.swarmId)
    } else {
      result.sessions = await this.spawnFanOut(config, project.repoPath, result.swarmId)
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

  private async spawnParallel(
    config: SwarmConfig,
    repoPath: string,
    swarmId: string,
  ): Promise<SpawnedSession[]> {
    return Promise.all(
      config.agents.map((agentConfig) =>
        this.spawnAgent({
          agentConfig,
          basePrompt: config.prompt,
          projectId: config.projectId,
          repoPath,
          swarmId,
        }),
      ),
    )
  }

  private async spawnSequential(
    config: SwarmConfig,
    repoPath: string,
    swarmId: string,
  ): Promise<SpawnedSession[]> {
    const sessions: SpawnedSession[] = []
    let previousOutput = ''

    for (const agentConfig of config.agents) {
      const session = await this.spawnAgent({
        agentConfig,
        basePrompt: config.prompt,
        projectId: config.projectId,
        repoPath,
        swarmId,
        previousOutput,
      })

      previousOutput = session.output ?? previousOutput
      sessions.push(session)
    }

    return sessions
  }

  private async spawnFanOut(
    config: SwarmConfig,
    repoPath: string,
    swarmId: string,
  ): Promise<SpawnedSession[]> {
    return this.spawnParallel(config, repoPath, swarmId)
  }

  private async spawnAgent(input: {
    agentConfig: SwarmAgentConfig
    basePrompt: string
    projectId: string
    repoPath: string
    swarmId: string
    previousOutput?: string
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
        projectId: input.projectId,
        prompt,
        role: input.agentConfig.role,
        agentId: decision.agentId,
        model: decision.model,
        repoPath: worktreePath,
      })

      const actualSessionId = dispatchResult?.sessionId ?? provisionalSessionId
      if (actualSessionId !== provisionalSessionId) {
        dependencies.worktrees.reassignSession(provisionalSessionId, actualSessionId)
      }

      return {
        sessionId: actualSessionId,
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

  private requireDependencies(): Required<SwarmOrchestratorDependencies> {
    const { getProject, routeModel, dispatchSession } = this.dependencies

    if (!getProject || !routeModel || !dispatchSession) {
      throw new Error(
        'SwarmOrchestrator dependencies are not configured. Wire project lookup, model routing, and session dispatch before spawning swarms.',
      )
    }

    return {
      getProject,
      routeModel,
      dispatchSession,
      cancelSession: this.dependencies.cancelSession ?? (() => undefined),
      worktrees: this.dependencies.worktrees ?? worktreeManager,
    }
  }
}

function validateConfig(config: SwarmConfig): void {
  if (!config.projectId.trim()) throw new Error('Swarm projectId is required')
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

function cloneResult(result: SwarmResult): SwarmResult {
  return {
    ...result,
    sessions: result.sessions.map((session) => ({ ...session })),
  }
}

function createDefaultDependencies(): SwarmOrchestratorDependencies {
  return {
    getProject: (projectId) => projectsStore.get(projectId) ?? undefined,
    routeModel: (input) => modelRouter.route(input),
    dispatchSession: async (input) => {
      const sessionId = await sessionManager.dispatch({
        projectId: input.projectId,
        prompt: input.prompt,
        agentId: input.agentId,
        model: input.model,
        repoPath: input.repoPath,
        context: projectsStore.getContext(input.projectId),
        isolate: false,
      })

      return { sessionId, status: 'running' }
    },
    cancelSession: (sessionId) => sessionManager.cancel(sessionId),
    worktrees: worktreeManager,
  }
}

export const swarmOrchestrator = new SwarmOrchestrator(createDefaultDependencies())
