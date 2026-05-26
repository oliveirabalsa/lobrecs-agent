import type {
  SwarmAgentConfig,
  SwarmConfig,
} from '../../../shared/types'
import type { SpecContract } from '../../modules/swarms/domain/specContract'
import { VERDICT_INSTRUCTION } from '../reviewVerdict'
import { parseReviewerVerdict } from '../reviewVerdict'
import { askStepApproval, type StepApprovalResult } from '../stepApprovalPrompt'

export interface SwarmCompletionResult {
  status: string
  output?: string
}

export interface SpawnedSession {
  sessionId: string
  threadId: string
  role: string
  worktreePath: string | null
  status: string
  agentId?: string
  model?: string
  output?: string
}

export interface StepOrchestrationContext {
  swarmId: string
  threadId: string
  projectId: string
  repoPath: string
  basePrompt: string
  maxIterations: number
  remainingAgents: SwarmAgentConfig[]
  previousSession: SpawnedSession
  previousAgentConfig: SwarmAgentConfig
  specContract?: SpecContract
}

export interface StepOrchestrationDeps {
  waitForCompletion: (session: SpawnedSession) => Promise<SwarmCompletionResult>
  spawnAgent: (input: SpawnAgentInput) => Promise<SpawnedSession>
  hasSwarm: (swarmId: string) => boolean
  addSession: (swarmId: string, session: SpawnedSession) => void
}

export interface SpawnAgentInput {
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
  imageAttachments?: unknown[]
  autoAgentSelection?: boolean
  specContract?: SpecContract
}

export function createStepOrchestrator(deps: StepOrchestrationDeps) {
  return function orchestrateSteps(
    input: StepOrchestrationContext,
  ): Promise<void> {
    return orchestrateStepsImpl(input, deps)
  }
}

async function orchestrateStepsImpl(
  input: StepOrchestrationContext,
  deps: StepOrchestrationDeps,
): Promise<void> {
  let previousSession = input.previousSession
  let previousOutput = input.previousSession.output ?? ''
  let previousAgentConfig = input.previousAgentConfig
  let specContract: SpecContract | undefined = input.specContract

  for (const agentConfig of input.remainingAgents) {
    if (!deps.hasSwarm(input.swarmId)) return

    const completion = await deps.waitForCompletion(previousSession)
    previousSession.status = completion.status
    if (completion.output?.trim()) previousOutput = completion.output
    if (completion.status !== 'done') return
    if (!deps.hasSwarm(input.swarmId)) return

    if (!specContract && isPlanningRole(previousAgentConfig.role) && previousOutput) {
      specContract = extractSpecContractLocal(previousOutput) ?? undefined
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
      if (!deps.hasSwarm(input.swarmId)) return

      if (approval.editedPromptSuffix || approval.modelOverride) {
        effectiveAgentConfig = {
          ...agentConfig,
          ...(approval.editedPromptSuffix
            ? { promptSuffix: approval.editedPromptSuffix }
            : {}),
          ...(approval.modelOverride ? { modelOverride: approval.modelOverride } : {}),
        }
      }
    }

    if (isReviewerRole(effectiveAgentConfig.role)) {
      await runReviewCycle({
        swarmId: input.swarmId,
        threadId: input.threadId,
        projectId: input.projectId,
        repoPath: input.repoPath,
        basePrompt: input.basePrompt,
        implementerConfig: previousAgentConfig,
        reviewerConfig: effectiveAgentConfig,
        maxIterations: input.maxIterations,
        implementerOutput: previousOutput,
      }, deps)
      return
    }

    const nextSession = await deps.spawnAgent({
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

    deps.addSession(input.swarmId, nextSession)
    previousSession = nextSession
    previousAgentConfig = effectiveAgentConfig
    previousOutput = nextSession.output ?? previousOutput
  }

  const completion = await deps.waitForCompletion(previousSession)
  previousSession.status = completion.status
}

interface ReviewCycleInput {
  swarmId: string
  threadId: string
  projectId: string
  repoPath: string
  basePrompt: string
  implementerConfig: SwarmAgentConfig
  reviewerConfig: SwarmAgentConfig
  maxIterations: number
  implementerOutput: string
}

async function runReviewCycle(
  input: ReviewCycleInput,
  deps: StepOrchestrationDeps,
): Promise<void> {
  let implementerOutput = input.implementerOutput

  for (let iteration = 1; iteration <= input.maxIterations; iteration += 1) {
    if (!deps.hasSwarm(input.swarmId)) return

    const reviewer = await deps.spawnAgent({
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

    deps.addSession(input.swarmId, reviewer)

    const reviewerCompletion = await deps.waitForCompletion(reviewer)
    reviewer.status = reviewerCompletion.status
    if (reviewerCompletion.status !== 'done') return
    if (!deps.hasSwarm(input.swarmId)) return

    const parsed = parseReviewerVerdict(reviewerCompletion.output ?? '')
    if (parsed.verdict === 'approved') return
    if (iteration === input.maxIterations) return

    const implementer = await deps.spawnAgent({
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

    deps.addSession(input.swarmId, implementer)

    const implementerCompletion = await deps.waitForCompletion(implementer)
    implementer.status = implementerCompletion.status
    if (implementerCompletion.status !== 'done') return

    implementerOutput = implementerCompletion.output ?? implementerOutput
  }
}

function isReviewerRole(role: string): boolean {
  return /\breview/i.test(role)
}

function isPlanningRole(role: string): boolean {
  return /\b(plan|planner|planning|architect|design|scope|research|analy)/i.test(role)
}

function extractSpecContractLocal(output: string): SpecContract | null {
  const specHeaderIndex = output.search(/##\s*Spec\s+Contract/i)
  const searchRegion = specHeaderIndex !== -1 ? output.slice(specHeaderIndex) : output

  const fenced = searchRegion.match(/```(?:json)?\s*([\s\S]*?)```/)
  const specBlock = fenced?.[1]?.trim() ?? (() => {
    const firstBrace = searchRegion.indexOf('{')
    const lastBrace = searchRegion.lastIndexOf('}')
    return firstBrace !== -1 && lastBrace > firstBrace
      ? searchRegion.slice(firstBrace, lastBrace + 1)
      : null
  })()

  if (!specBlock) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(specBlock)
  } catch {
    return null
  }

  return validateSpecContractLocal(parsed)
}

function validateSpecContractLocal(value: unknown): SpecContract | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>

  const ac = record.acceptanceCriteria
  if (!Array.isArray(ac) || ac.length === 0) return null

  const criteria: Array<{ id: string; description: string; testable: boolean }> = []
  for (const item of ac) {
    if (!item || typeof item !== 'object') return null
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'string' || typeof r.description !== 'string') return null
    criteria.push({ id: r.id, description: r.description, testable: r.testable !== false })
  }

  const rawInterfaces = Array.isArray(record.interfaces) ? record.interfaces : []
  const interfaces: Array<{ name: string; signature: string; file: string }> = []
  for (const item of rawInterfaces) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.name !== 'string' || typeof r.signature !== 'string' || typeof r.file !== 'string') continue
    interfaces.push({ name: r.name, signature: r.signature, file: r.file })
  }

  const rawFileManifest = Array.isArray(record.fileManifest) ? record.fileManifest : []
  const fileManifest: Array<{ path: string; action: 'create' | 'modify' | 'delete'; purpose: string }> = []
  for (const item of rawFileManifest) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.path !== 'string' || typeof r.purpose !== 'string') continue
    if (r.action !== 'create' && r.action !== 'modify' && r.action !== 'delete') continue
    fileManifest.push({ path: r.path, action: r.action, purpose: r.purpose })
  }

  const rawTestScenarios = Array.isArray(record.testScenarios) ? record.testScenarios : []
  const testScenarios: Array<{ id: string; description: string; covers: string[] }> = []
  for (const item of rawTestScenarios) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'string' || typeof r.description !== 'string') continue
    if (!Array.isArray(r.covers)) continue
    const covers = r.covers.filter((c): c is string => typeof c === 'string')
    testScenarios.push({ id: r.id, description: r.description, covers })
  }

  return {
    acceptanceCriteria: criteria,
    interfaces,
    fileManifest,
    testScenarios,
  }
}
