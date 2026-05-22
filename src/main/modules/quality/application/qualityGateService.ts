import { spawn } from 'node:child_process'
import path from 'node:path'
import { buildProcessEnvironment } from '../../../process/environment'
import type {
  AgentActivity,
  AppSettings,
  DiffProposal,
  RoutingDecision,
  SupportedAgentId,
  VerificationRecipe,
} from '../../../../shared/types'

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
}

interface VerificationFailure {
  recipe: VerificationRecipe
  output: string
}

export async function runQualityGate(
  input: QualityGateInput,
  dependencies: QualityGateDependencies,
): Promise<void> {
  const settings = dependencies.getSettings(input.projectId)
  if (!settings.verification.autoRunAfterAgentDiffs) return

  const changedFiles = input.changedFiles.filter((proposal) => proposal.status === 'applied')
  if (changedFiles.length === 0) return

  const recipes = selectAutoRecipes(settings)
  if (recipes.length === 0) return

  input.emitActivity({
    kind: 'step',
    title: 'Automated QA started',
    detail: `Running ${recipes.map((recipe) => recipe.label).join(', ')} before marking this done.`,
    status: 'running',
  })

  const failure = await runRecipes(input, dependencies, settings, recipes)
  if (!failure) {
    input.emitActivity({
      kind: 'step',
      title: 'Automated QA passed',
      detail: `${recipes.length} verification command${recipes.length === 1 ? '' : 's'} passed.`,
      status: 'done',
    })
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
    return
  }

  await dispatchRepair(input, dependencies, settings, changedFiles, failure)
}

async function runRecipes(
  input: QualityGateInput,
  dependencies: QualityGateDependencies,
  settings: AppSettings,
  recipes: VerificationRecipe[],
): Promise<VerificationFailure | null> {
  for (const recipe of recipes) {
    input.emitActivity({
      kind: 'command',
      command: recipe.command,
      cwd: input.repoPath,
      status: 'running',
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
      return { recipe, output }
    }
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
    !hasRequiredPrefix(recipe.command, settings.execution.commandPrefix)
  ) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Verification command must start with "${settings.execution.commandPrefix}".`,
    }
  }

  const runner = dependencies.runCommand ?? runShellCommand
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
  const preferredAgentId = settings.agents.fallbackAgentId
  const route = await dependencies.routeModel({
    projectId: input.projectId,
    prompt,
    preferredAgentId,
  })

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

function hasRequiredPrefix(command: string, prefix: string): boolean {
  const trimmedCommand = command.trim()
  const trimmedPrefix = prefix.trim()
  if (!trimmedPrefix) return true

  return trimmedCommand === trimmedPrefix || trimmedCommand.startsWith(`${trimmedPrefix} `)
}

function runShellCommand(
  command: string,
  cwd: string,
  options: { timeoutMs: number; maxOutputBytes: number },
): Promise<QualityGateCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      env: buildProcessEnvironment(),
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    const timeout = setTimeout(() => {
      settled = true
      child.kill('SIGTERM')
      resolve({
        exitCode: 124,
        stdout,
        stderr: `${stderr}\nVerification timed out after ${options.timeoutMs / 1_000}s.`,
      })
    }, options.timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = truncateOutput(stdout + chunk.toString(), options.maxOutputBytes)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = truncateOutput(stderr + chunk.toString(), options.maxOutputBytes)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ exitCode: 1, stdout, stderr: error.message })
    })
    child.on('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({
        exitCode: code ?? (signal ? 1 : 0),
        stdout,
        stderr,
      })
    })
  })
}

function truncateOutput(output: string, maxBytes: number): string {
  if (Buffer.byteLength(output, 'utf-8') <= maxBytes) return output

  return `${Buffer.from(output, 'utf-8').subarray(0, maxBytes).toString('utf-8')}\n[output truncated]`
}
