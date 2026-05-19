import { randomUUID } from 'node:crypto'
import type {
  Project,
  RoutingDecision,
  SessionStatus,
  AppSettings,
  SupportedAgentId,
  SwarmAgentConfig,
  SwarmConfig,
  SwarmResult,
} from '../../shared/types'
import { worktreeManager, type WorktreeManager } from '../git/WorktreeManager'
import { DEFAULT_APP_SETTINGS, settingsService } from '../modules/settings'
import { modelRouter } from '../router'
import { sessionManager } from '../session'
import { projectsStore, sessionsStore, threadsStore } from '../store'
import type { PlanPromptOutcome } from './planPrompt'
import { parseReviewerVerdict, VERDICT_INSTRUCTION } from './reviewVerdict'

const DEFAULT_REVIEW_LOOP_MAX_ITERATIONS = 3
const REVIEW_LOOP_HARD_CAP = 10

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
  projectId: string
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

    if (config.strategy === 'parallel') {
      result.sessions = await this.spawnParallel(config, project.repoPath, result.swarmId, threadId)
    } else if (config.strategy === 'sequential') {
      result.sessions = await this.spawnSequential(
        config,
        project.repoPath,
        result.swarmId,
        threadId,
        settings,
      )
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
    settings: AppSettings,
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
      maxIterations: clampReviewLoopIterations(
        config.maxIterations,
        settings.swarms.maxReviewerIterations,
      ),
      remainingAgents,
      previousSession: firstSession,
      previousAgentConfig: firstAgent,
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

    for (const agentConfig of input.remainingAgents) {
      if (!this.swarms.has(input.swarmId)) return

      const completion = await this.waitForCompletion(previousSession)
      previousSession.status = completion.status
      if (completion.output?.trim()) previousOutput = completion.output
      if (completion.status !== 'done') return
      if (!this.swarms.has(input.swarmId)) return

      if (isReviewerRole(agentConfig.role)) {
        await this.runReviewCycle({
          swarmId: input.swarmId,
          threadId: input.threadId,
          projectId: input.projectId,
          repoPath: input.repoPath,
          basePrompt: input.basePrompt,
          implementerConfig: previousAgentConfig,
          reviewerConfig: agentConfig,
          maxIterations: input.maxIterations,
          implementerOutput: previousOutput,
        })
        return
      }

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
      previousAgentConfig = agentConfig
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
    contextLabel?: string
    extraInstruction?: string
    imageAttachments?: Array<{ id: string; name?: string; mimeType: string; dataUrl: string; size: number }>
  }): Promise<SpawnedSession> {
    const dependencies = this.requireDependencies()
    const provisionalSessionId = randomUUID()
    const prompt = buildAgentPrompt(
      input.basePrompt,
      input.agentConfig,
      input.previousOutput,
      { contextLabel: input.contextLabel, extraInstruction: input.extraInstruction },
    )

    const decision = await dependencies.routeModel({
      projectId: input.projectId,
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
  if (!['parallel', 'sequential', 'fan-out'].includes(config.strategy)) {
    throw new Error(`Unsupported swarm strategy: ${config.strategy}`)
  }
  if (config.agents.length === 0) throw new Error('At least one swarm agent is required')
  if (config.agents.length > settings.swarms.maxAgents) {
    throw new Error(`Swarm agent limit is ${settings.swarms.maxAgents}`)
  }

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

function isReviewerRole(role: string): boolean {
  return /\breview/i.test(role)
}

function buildAgentPrompt(
  basePrompt: string,
  agentConfig: SwarmAgentConfig,
  previousOutput?: string,
  options?: { contextLabel?: string; extraInstruction?: string },
): string {
  const lines = [`[Role: ${agentConfig.role}]`, basePrompt.trim()]

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
      const settings = settingsService.getEffective(input.projectId).settings
      const { sessionId, threadId } = await sessionManager.dispatch({
        projectId: input.projectId,
        threadId: input.threadId,
        prompt: input.prompt,
        agentId: input.agentId,
        model: input.model,
        repoPath: input.repoPath,
        context: projectsStore.getContext(input.projectId),
        isolate: settings.execution.worktreeIsolation,
        runtimeSettings: settings.agents.runtimes[input.agentId],
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
