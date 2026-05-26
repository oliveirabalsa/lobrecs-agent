import { randomUUID } from 'node:crypto'
import type { ModelTier, SupportedAgentId } from '../../shared/types'
import type {
  MultitaskDecomposeRequest,
  MultitaskPlan,
  MultitaskTask,
} from '../../shared/contracts/multitask'
import { buildDecomposerPrompt, parseDecomposerOutput, type RawDecomposedTask } from './decomposerPrompt'

export interface TaskDecomposerDependencies {
  dispatchAndWait: (input: {
    projectId: string
    threadId?: string
    parentSessionId?: string
    prompt: string
    agentId: SupportedAgentId
    model: string
  }) => Promise<string>
  routeModel: (input: {
    projectId: string
    prompt: string
    preferredAgentId: SupportedAgentId
    autoAgentSelection?: boolean
    minimumTier?: ModelTier
    agentPreference?: SupportedAgentId[]
  }) => Promise<{ agentId: SupportedAgentId; model: string; tier: ModelTier }>
  estimateCost: (model: string, prompt: string) => number
}

const COMPLEXITY_TO_TIER: Record<RawDecomposedTask['complexity'], ModelTier> = {
  low: 'lightweight',
  medium: 'balanced',
  high: 'advanced',
  critical: 'frontier',
}

const MULTITASK_DECOMPOSER_AGENT_PREFERENCE: SupportedAgentId[] = [
  'codex',
  'claude-code',
  'antigravity',
  'cursor',
  'opencode',
]

const MULTITASK_TASK_AGENT_ROTATION: SupportedAgentId[] = [
  'codex',
  'claude-code',
  'antigravity',
  'cursor',
]

export class TaskDecomposer {
  constructor(private dependencies: TaskDecomposerDependencies) {}

  async decompose(
    request: MultitaskDecomposeRequest,
    context: { threadId?: string; parentSessionId?: string; maxTasks?: number } = {},
  ): Promise<MultitaskPlan> {
    const decomposerRouting = await this.dependencies.routeModel({
      projectId: request.projectId,
      prompt: request.prompt,
      preferredAgentId: 'codex',
      autoAgentSelection: true,
      minimumTier: 'advanced',
      agentPreference: MULTITASK_DECOMPOSER_AGENT_PREFERENCE,
    })

    const maxTasks = normalizeMaxTasks(context.maxTasks)
    const systemPrompt = buildDecomposerPrompt(maxTasks)
    const fullPrompt = `${systemPrompt}\n\nUser request:\n${request.prompt}`

    const output = await this.dependencies.dispatchAndWait({
      projectId: request.projectId,
      threadId: context.threadId ?? request.threadId,
      parentSessionId: context.parentSessionId,
      prompt: fullPrompt,
      agentId: decomposerRouting.agentId,
      model: decomposerRouting.model,
    })

    const rawTasks = enforceMaxTasks(parseDecomposerOutput(output), maxTasks)
    const titleToId = new Map<string, string>()

    for (const raw of rawTasks) {
      titleToId.set(raw.title, randomUUID())
    }

    const tasks: MultitaskTask[] = await Promise.all(
      rawTasks.map(async (raw, index) => {
        const tierHint = COMPLEXITY_TO_TIER[raw.complexity]
        const routing = await this.dependencies.routeModel({
          projectId: request.projectId,
          prompt: buildTaskRoutingPrompt(raw, request.prompt),
          preferredAgentId: preferredTaskAgent(index),
          autoAgentSelection: true,
          minimumTier: tierHint,
          agentPreference: taskAgentPreference(index),
        })

        const effectiveTier = maxTier(tierHint, routing.tier)
        const estimatedCostUsd = this.dependencies.estimateCost(routing.model, raw.description)
        const dependsOnIds = resolveDependsOn(raw.dependsOn, titleToId)

        return {
          id: titleToId.get(raw.title)!,
          title: raw.title,
          description: raw.description,
          tier: effectiveTier,
          agentId: routing.agentId,
          model: routing.model,
          ...(estimatedCostUsd > 0 ? { estimatedCostUsd } : {}),
          ...(dependsOnIds.length > 0 ? { dependsOn: dependsOnIds } : {}),
        }
      }),
    )

    const totalEstimatedCostUsd = tasks.reduce(
      (sum, task) => sum + (task.estimatedCostUsd ?? 0),
      0,
    )

    return {
      planId: randomUUID(),
      originalPrompt: request.prompt,
      tasks,
      totalEstimatedCostUsd,
      decomposedBy: {
        agentId: decomposerRouting.agentId,
        model: decomposerRouting.model,
      },
    }
  }
}

export function enforceMaxTasks(
  tasks: readonly RawDecomposedTask[],
  maxTasks: number | undefined,
): RawDecomposedTask[] {
  const normalizedMaxTasks = normalizeMaxTasks(maxTasks)
  if (!normalizedMaxTasks || tasks.length <= normalizedMaxTasks) return [...tasks]

  const capped = tasks.slice(0, normalizedMaxTasks)
  const overflow = tasks.slice(normalizedMaxTasks)
  const last = capped.at(-1)
  if (!last) return []

  const retainedDependencyTitles = new Set(capped.slice(0, -1).map((task) => task.title))
  const dependsOn = [
    ...(last.dependsOn ?? []),
    ...overflow.flatMap((task) => task.dependsOn ?? []),
  ].filter((title, index, all) => retainedDependencyTitles.has(title) && all.indexOf(title) === index)

  const overflowSummary = overflow
    .map((task) => `- ${task.title}: ${task.description}`)
    .join('\n')

  const consolidatedTask: RawDecomposedTask = {
    title: last.title,
    description: [
        last.description,
        '',
        `Additional subtasks consolidated because this project allows at most ${normalizedMaxTasks} swarm agents:`,
        overflowSummary,
      ].join('\n'),
    complexity: maxComplexity([last, ...overflow]),
    ...(dependsOn.length > 0 ? { dependsOn } : {}),
  }

  return [...capped.slice(0, -1), consolidatedTask]
}

function resolveDependsOn(
  titles: string[] | undefined,
  titleToId: Map<string, string>,
): string[] {
  if (!titles || titles.length === 0) return []

  return titles
    .map((title) => titleToId.get(title))
    .filter((id): id is string => id !== undefined)
}

function maxTier(a: ModelTier, b: ModelTier): ModelTier {
  const order: ModelTier[] = ['lightweight', 'balanced', 'advanced', 'frontier']
  return order.indexOf(a) >= order.indexOf(b) ? a : b
}

function maxComplexity(tasks: readonly RawDecomposedTask[]): RawDecomposedTask['complexity'] {
  const order: Array<RawDecomposedTask['complexity']> = ['low', 'medium', 'high', 'critical']
  return tasks.reduce<RawDecomposedTask['complexity']>(
    (max, task) =>
      order.indexOf(task.complexity) > order.indexOf(max) ? task.complexity : max,
    'low',
  )
}

function normalizeMaxTasks(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : undefined
}

function preferredTaskAgent(index: number): SupportedAgentId {
  return MULTITASK_TASK_AGENT_ROTATION[index % MULTITASK_TASK_AGENT_ROTATION.length]
}

function taskAgentPreference(index: number): SupportedAgentId[] {
  const offset = index % MULTITASK_TASK_AGENT_ROTATION.length
  return [
    ...MULTITASK_TASK_AGENT_ROTATION.slice(offset),
    ...MULTITASK_TASK_AGENT_ROTATION.slice(0, offset),
    'opencode',
  ]
}

function buildTaskRoutingPrompt(raw: RawDecomposedTask, originalPrompt: string): string {
  return [
    `Task title: ${raw.title}`,
    `Task complexity: ${raw.complexity}`,
    `Task description: ${raw.description}`,
    `Original user request: ${originalPrompt}`,
  ].join('\n')
}
