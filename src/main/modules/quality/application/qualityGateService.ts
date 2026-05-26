import path from 'node:path'
import {
  hasRequiredCommandPrefix,
  runVerificationCommand,
  truncateOutput,
} from '../../../process/verification'
import type {
  AgentActivity,
  AppSettings,
  DiffProposal,
  RoutingDecision,
  RunAuditPhase,
  RunAuditStopReason,
  SupportedAgentId,
  VerificationRecipe,
} from '../../../../shared/types'

export interface QualityGateAuditInput {
  sessionId: string
  threadId: string
  attempt: number
  phase: RunAuditPhase
  recipeId?: string
  recipeLabel?: string
  command?: string
  exitCode?: number
  outputTail?: string
  changedFiles?: string[]
  repairSessionId?: string
  stopReason?: RunAuditStopReason
  finalStatus?: 'passed' | 'failed' | 'pending'
}

export interface QualityGateInput {
  sessionId: string
  threadId: string
  projectId: string
  repoPath: string
  changedFiles: DiffProposal[]
  attempt: number
  emitActivity(payload: AgentActivity): void
}

export interface QualityGateCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface QualityGateDependencies {
  getSettings(projectId: string): AppSettings
  routeModel(input: {
    projectId: string
    prompt: string
    preferredAgentId: SupportedAgentId
  }): Promise<Pick<RoutingDecision, 'agentId' | 'model'>>
  dispatchRepair(input: {
    projectId: string
    threadId: string
    prompt: string
    agentId: SupportedAgentId
    model: string
    repoPath: string
    qualityAttempt: number
  }): Promise<{ sessionId: string }>
  runCommand?: (
    command: string,
    cwd: string,
    options: { timeoutMs: number; maxOutputBytes: number },
  ) => Promise<QualityGateCommandResult>
  recordAudit?: (input: QualityGateAuditInput) => void
  getLastAudit?: (sessionId: string) => {
    recipeId?: string
    exitCode?: number
    phase: RunAuditPhase
  } | null
  /**
   * Returns true when another QA-repair session is already running. Used to
   * serialize repairs: with multiple parallel sessions verifying the same
   * project build, every failure would otherwise spawn its own repair agent
   * for the same root cause.
   */
  isRepairInFlight?: () => boolean
  observeQualityGate?: (input: {
    projectId: string
    projectPath: string
    sessionId: string
    phase: RunAuditPhase
    recipeId?: string
    command?: string
    exitCode?: number
  }) => Promise<void>
  gateRetry?: (input: {
    projectId: string
    projectPath: string
    sessionId: string
    reason: string
  }) => Promise<{ allow: boolean; reason?: string }>
}

interface VerificationFailure {
  recipe: VerificationRecipe
  output: string
  exitCode: number
}

export async function runQualityGate(
  input: QualityGateInput,
  dependencies: QualityGateDependencies,
): Promise<void> {
  const settings = dependencies.getSettings(input.projectId)
  if (!settings.verification.autoRunAfterAgentDiffs) return

  const changedFiles = input.changedFiles.filter((proposal) => proposal.status === 'applied')
  if (changedFiles.length === 0) {
    emitAudit(dependencies, input, {
      phase: 'repair-skipped',
      stopReason: 'no-diff',
      finalStatus: 'pending',
    })
    return
  }

  const recipes = selectAutoRecipes(settings)
  if (recipes.length === 0) return
  void observeQualityGate(dependencies, input, { phase: 'recipe-started' })

  input.emitActivity({
    kind: 'step',
    title: 'Automated QA started',
    detail: `Running ${recipes.map((recipe) => recipe.label).join(', ')} before marking this done.`,
    status: 'running',
  })

  const changedPaths = changedFiles.map((proposal) => proposal.filePath)
  const failure = await runRecipes(input, dependencies, settings, recipes, changedPaths)
  if (!failure) {
    input.emitActivity({
      kind: 'step',
      title: 'Automated QA passed',
      detail: `${recipes.length} verification command${recipes.length === 1 ? '' : 's'} passed.`,
      status: 'done',
    })
    emitAudit(dependencies, input, {
      phase: 'gate-passed',
      stopReason: 'passed',
      finalStatus: 'passed',
      changedFiles: changedPaths,
    })
    void observeQualityGate(dependencies, input, { phase: 'gate-passed' })
    return
  }

  input.emitActivity({
    kind: 'step',
    title: 'Automated QA failed',
    detail: summarizeFailure(failure),
    status: 'error',
  })

  if (input.attempt >= settings.verification.selfHealingMaxAttempts) {
    input.emitActivity({
      kind: 'step',
      title: 'Self-healing stopped',
      detail: `Reached the configured repair limit of ${settings.verification.selfHealingMaxAttempts}.`,
      status: 'error',
    })
    emitAudit(dependencies, input, {
      phase: 'gate-stopped',
      stopReason: 'max-attempts',
      finalStatus: 'failed',
      recipeId: failure.recipe.id,
      recipeLabel: failure.recipe.label,
      command: failure.recipe.command,
      exitCode: failure.exitCode,
      outputTail: failure.output,
      changedFiles: changedPaths,
    })
    void observeQualityGate(dependencies, input, {
      phase: 'gate-stopped',
      recipeId: failure.recipe.id,
      command: failure.recipe.command,
      exitCode: failure.exitCode,
    })
    return
  }

  if (isRepeatFailure(dependencies, input, failure)) {
    input.emitActivity({
      kind: 'step',
      title: 'Self-healing stopped',
      detail: `${failure.recipe.label} failed twice in a row with the same exit code; manual review required.`,
      status: 'error',
    })
    emitAudit(dependencies, input, {
      phase: 'gate-stopped',
      stopReason: 'repeat-failure',
      finalStatus: 'failed',
      recipeId: failure.recipe.id,
      recipeLabel: failure.recipe.label,
      command: failure.recipe.command,
      exitCode: failure.exitCode,
      outputTail: failure.output,
      changedFiles: changedPaths,
    })
    void observeQualityGate(dependencies, input, {
      phase: 'gate-stopped',
      recipeId: failure.recipe.id,
      command: failure.recipe.command,
      exitCode: failure.exitCode,
    })
    return
  }

  if (dependencies.isRepairInFlight?.()) {
    input.emitActivity({
      kind: 'step',
      title: 'Self-healing skipped',
      detail: 'Another repair session is already running for this project; waiting for it to complete.',
      status: 'error',
    })
    emitAudit(dependencies, input, {
      phase: 'gate-stopped',
      stopReason: 'repair-in-flight',
      finalStatus: 'failed',
      recipeId: failure.recipe.id,
      recipeLabel: failure.recipe.label,
      command: failure.recipe.command,
      exitCode: failure.exitCode,
      outputTail: failure.output,
      changedFiles: changedPaths,
    })
    void observeQualityGate(dependencies, input, {
      phase: 'gate-stopped',
      recipeId: failure.recipe.id,
      command: failure.recipe.command,
      exitCode: failure.exitCode,
    })
    return
  }

  const retryGate = await shouldAllowRepairRetry(dependencies, input, failure)
  if (!retryGate.allow) {
    input.emitActivity({
      kind: 'step',
      title: 'Self-healing blocked',
      detail: retryGate.reason ?? 'An extension retry gate blocked the repair retry.',
      status: 'error',
    })
    emitAudit(dependencies, input, {
      phase: 'gate-stopped',
      stopReason: 'extension-gated',
      finalStatus: 'failed',
      recipeId: failure.recipe.id,
      recipeLabel: failure.recipe.label,
      command: failure.recipe.command,
      exitCode: failure.exitCode,
      outputTail: failure.output,
      changedFiles: changedPaths,
    })
    void observeQualityGate(dependencies, input, {
      phase: 'gate-stopped',
      recipeId: failure.recipe.id,
      command: failure.recipe.command,
      exitCode: failure.exitCode,
    })
    return
  }

  await dispatchRepair(input, dependencies, settings, changedFiles, failure)
}

async function observeQualityGate(
  dependencies: QualityGateDependencies,
  input: QualityGateInput,
  event: {
    phase: RunAuditPhase
    recipeId?: string
    command?: string
    exitCode?: number
  },
): Promise<void> {
  try {
    await dependencies.observeQualityGate?.({
      projectId: input.projectId,
      projectPath: input.repoPath,
      sessionId: input.sessionId,
      ...event,
    })
  } catch {
    // Observation hooks must not alter the built-in quality gate result.
  }
}

async function shouldAllowRepairRetry(
  dependencies: QualityGateDependencies,
  input: QualityGateInput,
  failure: VerificationFailure,
): Promise<{ allow: boolean; reason?: string }> {
  if (!dependencies.gateRetry) return { allow: true }
  try {
    return await dependencies.gateRetry({
      projectId: input.projectId,
      projectPath: input.repoPath,
      sessionId: input.sessionId,
      reason: `${failure.recipe.label} failed with exit code ${failure.exitCode}.`,
    })
  } catch (error) {
    return {
      allow: false,
      reason: `Extension retry gate failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    }
  }
}

function isRepeatFailure(
  dependencies: QualityGateDependencies,
  input: QualityGateInput,
  failure: VerificationFailure,
): boolean {
  if (input.attempt === 0) return false
  const previous = dependencies.getLastAudit?.(input.sessionId)
  if (!previous || previous.phase !== 'recipe-failed') return false
  return (
    previous.recipeId === failure.recipe.id &&
    previous.exitCode === failure.exitCode
  )
}

function emitAudit(
  dependencies: QualityGateDependencies,
  input: QualityGateInput,
  partial: Omit<QualityGateAuditInput, 'sessionId' | 'threadId' | 'attempt'>,
): void {
  dependencies.recordAudit?.({
    sessionId: input.sessionId,
    threadId: input.threadId,
    attempt: input.attempt,
    ...partial,
  })
}

async function runRecipes(
  input: QualityGateInput,
  dependencies: QualityGateDependencies,
  settings: AppSettings,
  recipes: VerificationRecipe[],
  changedPaths: string[],
): Promise<VerificationFailure | null> {
  for (const recipe of recipes) {
    input.emitActivity({
      kind: 'command',
      command: recipe.command,
      cwd: input.repoPath,
      status: 'running',
    })

    emitAudit(dependencies, input, {
      phase: 'recipe-started',
      recipeId: recipe.id,
      recipeLabel: recipe.label,
      command: recipe.command,
      changedFiles: changedPaths,
    })

    const result = await runRecipe(recipe, input.repoPath, settings, dependencies)
    const output = truncateOutput(
      [result.stdout, result.stderr].filter(Boolean).join('\n\n'),
      settings.verification.maxOutputBytes,
    )

    input.emitActivity({
      kind: 'command',
      command: recipe.command,
      cwd: input.repoPath,
      status: result.exitCode === 0 ? 'done' : 'error',
    })

    if (result.exitCode !== 0) {
      emitAudit(dependencies, input, {
        phase: 'recipe-failed',
        recipeId: recipe.id,
        recipeLabel: recipe.label,
        command: recipe.command,
        exitCode: result.exitCode,
        outputTail: output,
        changedFiles: changedPaths,
      })
      void observeQualityGate(dependencies, input, {
        phase: 'recipe-failed',
        recipeId: recipe.id,
        command: recipe.command,
        exitCode: result.exitCode,
      })
      return { recipe, output, exitCode: result.exitCode }
    }

    emitAudit(dependencies, input, {
      phase: 'recipe-passed',
      recipeId: recipe.id,
      recipeLabel: recipe.label,
      command: recipe.command,
      exitCode: result.exitCode,
      changedFiles: changedPaths,
    })
    void observeQualityGate(dependencies, input, {
      phase: 'recipe-passed',
      recipeId: recipe.id,
      command: recipe.command,
      exitCode: result.exitCode,
    })
  }

  return null
}

async function runRecipe(
  recipe: VerificationRecipe,
  cwd: string,
  settings: AppSettings,
  dependencies: QualityGateDependencies,
): Promise<QualityGateCommandResult> {
  if (
    settings.verification.requireCommandPrefix &&
    !hasRequiredCommandPrefix(recipe.command, settings.execution.commandPrefix)
  ) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Verification command must start with "${settings.execution.commandPrefix}".`,
    }
  }

  const runner = dependencies.runCommand ?? runVerificationCommand
  return runner(recipe.command, cwd, {
    timeoutMs: settings.verification.defaultTimeoutSeconds * 1_000,
    maxOutputBytes: settings.verification.maxOutputBytes,
  })
}

async function dispatchRepair(
  input: QualityGateInput,
  dependencies: QualityGateDependencies,
  settings: AppSettings,
  changedFiles: DiffProposal[],
  failure: VerificationFailure,
): Promise<void> {
  const prompt = buildRepairPrompt(changedFiles, failure)
  const route = await routeRepairModel(input, dependencies, settings, prompt)

  const repair = await dependencies.dispatchRepair({
    projectId: input.projectId,
    threadId: input.threadId,
    prompt,
    agentId: route.agentId,
    model: route.model,
    repoPath: input.repoPath,
    qualityAttempt: input.attempt + 1,
  })

  input.emitActivity({
    kind: 'step',
    title: 'Self-healing repair started',
    detail: `Started repair session ${repair.sessionId} after ${failure.recipe.label} failed.`,
    status: 'done',
  })

  emitAudit(dependencies, input, {
    phase: 'repair-dispatched',
    recipeId: failure.recipe.id,
    recipeLabel: failure.recipe.label,
    command: failure.recipe.command,
    exitCode: failure.exitCode,
    outputTail: failure.output,
    changedFiles: changedFiles.map((proposal) => proposal.filePath),
    repairSessionId: repair.sessionId,
  })
  void observeQualityGate(dependencies, input, {
    phase: 'repair-dispatched',
    recipeId: failure.recipe.id,
    command: failure.recipe.command,
    exitCode: failure.exitCode,
  })
}

async function routeRepairModel(
  input: QualityGateInput,
  dependencies: QualityGateDependencies,
  settings: AppSettings,
  prompt: string,
): Promise<Pick<RoutingDecision, 'agentId' | 'model'>> {
  let fallbackRoute: Pick<RoutingDecision, 'agentId' | 'model'> | null = null
  let lastError: unknown = null

  for (const preferredAgentId of repairAgentCandidates(settings)) {
    try {
      const route = await dependencies.routeModel({
        projectId: input.projectId,
        prompt,
        preferredAgentId,
      })

      if (route.agentId === preferredAgentId || route.agentId !== 'claude-code') {
        return route
      }

      fallbackRoute ??= route
    } catch (error) {
      lastError = error
    }
  }

  if (fallbackRoute) return fallbackRoute
  if (lastError) throw lastError

  return dependencies.routeModel({
    projectId: input.projectId,
    prompt,
    preferredAgentId: settings.agents.fallbackAgentId,
  })
}

function repairAgentCandidates(settings: AppSettings): SupportedAgentId[] {
  const configuredAgents = uniqueAgentIds([
    settings.agents.fallbackAgentId,
    settings.agents.defaultAgentId,
    ...settings.agents.enabledAgentIds,
  ]).filter((agentId) => settings.agents.runtimes[agentId]?.enabled !== false)

  const nonClaude = configuredAgents.filter((agentId) => agentId !== 'claude-code')
  const claude = configuredAgents.filter((agentId) => agentId === 'claude-code')

  return [...nonClaude, ...claude]
}

function uniqueAgentIds(agentIds: SupportedAgentId[]): SupportedAgentId[] {
  return [...new Set(agentIds)]
}

function selectAutoRecipes(settings: AppSettings): VerificationRecipe[] {
  const byId = new Map(settings.verification.recipes.map((recipe) => [recipe.id, recipe]))
  const selected = settings.specs.defaultVerificationRecipeIds
    .map((id) => byId.get(id))
    .filter((recipe): recipe is VerificationRecipe => recipe !== undefined)

  if (selected.length > 0) return selected
  return settings.verification.recipes.filter((recipe) =>
    recipe.scope === 'build' || recipe.scope === 'test',
  )
}

function buildRepairPrompt(changedFiles: DiffProposal[], failure: VerificationFailure): string {
  const files = changedFiles
    .map((proposal) => `- ${path.relative(process.cwd(), proposal.filePath) || proposal.filePath}`)
    .join('\n')

  return [
    '[Role: QA repair agent]',
    'The previous agent completed code changes, but the automated quality gate failed.',
    '',
    'Fix the implementation so the failing verification command passes. Keep the change focused on the failure, preserve the existing architecture, and add or update tests only when they directly prove the fix.',
    '',
    'Changed files from the previous attempt:',
    files || '- No changed files were reported.',
    '',
    'Failing command:',
    failure.recipe.command,
    '',
    'Failure output:',
    failure.output.trim() || '(no output)',
  ].join('\n')
}

function summarizeFailure(failure: VerificationFailure): string {
  const output = failure.output.trim()
  if (!output) return `${failure.recipe.label} failed without output.`
  return `${failure.recipe.label} failed:\n${output.slice(0, 4_000)}`
}
