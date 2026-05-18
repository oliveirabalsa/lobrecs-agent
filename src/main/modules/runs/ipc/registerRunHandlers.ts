import { spawn } from 'node:child_process'
import { ipcMain } from 'electron'
import { buildProcessEnvironment } from '../../../process/environment'
import { projectsStore, sessionsStore, specRunsStore, specsStore } from '../../../store'
import type { MainIpcContext } from '../../shared/ipcContext'
import type {
  RunAttempt,
  RunAttemptStatus,
  SessionStatus,
  StartSpecRunInput,
} from '../../../../shared/types'

const VERIFICATION_TIMEOUT_MS = 120_000
const MAX_OUTPUT_CHARS = 120_000

export function registerRunHandlers(context: MainIpcContext): void {
  ipcMain.handle('runs:start', async (_event, input: StartSpecRunInput) => {
    const spec = specsStore.get(input.specId)
    if (!spec) throw new Error(`Spec not found: ${input.specId}`)

    const project = projectsStore.get(spec.projectId)
    if (!project) throw new Error(`Project not found: ${spec.projectId}`)
    const runMode = 'local'

    const { run, attempts } = specRunsStore.start(spec.id, runMode)
    const prompt = formatSpecPrompt(spec)

    for (const attempt of attempts) {
      try {
        const route = await context.modelRouter.route({
          prompt,
          preferredAgentId: attempt.agentId,
        })
        specRunsStore.updateAttempt(attempt.id, {
          model: route.model,
          status: 'running',
        })
        const { sessionId } = await context.sessionManager.dispatch({
          projectId: project.id,
          prompt,
          agentId: route.agentId,
          model: route.model,
          repoPath: project.repoPath,
          context: projectsStore.getContext(project.id),
          isolate: false,
        })
        specRunsStore.updateAttempt(attempt.id, {
          sessionId,
          model: route.model,
          status: 'running',
        })
      } catch {
        specRunsStore.updateAttempt(attempt.id, { status: 'failed' })
      }
    }

    const syncedAttempts = syncAttempts(run.id)
    if (syncedAttempts.every((attempt) => attempt.status === 'failed')) {
      specRunsStore.complete(run.id, 'failed')
    }

    return {
      run: specRunsStore.get(run.id) ?? run,
      attempts: specRunsStore.listAttempts(run.id),
    }
  })

  ipcMain.handle('runs:cancel', async (_event, runId: string) => {
    for (const attempt of specRunsStore.listAttempts(runId)) {
      if (attempt.sessionId && !isTerminalAttempt(attempt)) {
        context.sessionManager.cancel(attempt.sessionId)
      }
    }

    return specRunsStore.cancel(runId)
  })

  ipcMain.handle('runs:compare', async (_event, specId: string) => {
    const comparison = specRunsStore.compare(specId)
    for (const run of comparison.runs) {
      syncAttempts(run.id)
    }

    return specRunsStore.compare(specId)
  })

  ipcMain.handle('runs:verify', async (_event, runId: string, command: string) => {
    const run = specRunsStore.get(runId)
    if (!run) throw new Error(`Spec run not found: ${runId}`)

    const spec = specsStore.get(run.specId)
    if (!spec) throw new Error(`Spec not found: ${run.specId}`)

    const project = projectsStore.get(spec.projectId)
    if (!project) throw new Error(`Project not found: ${spec.projectId}`)

    syncAttempts(runId)
    const syncedRun = specRunsStore.get(runId)
    if (!syncedRun) throw new Error(`Spec run not found: ${runId}`)
    if (!isReviewableRun(syncedRun.status)) {
      throw new Error('Cannot verify before the agent run has completed')
    }

    const verification = specRunsStore.createVerification(runId, command)
    const result = await runVerificationCommand(command, project.repoPath)
    const status = result.exitCode === 0 ? 'passed' : 'failed'
    const output = truncateOutput(
      [result.stdout, result.stderr].filter(Boolean).join('\n\n'),
    )

    return specRunsStore.finishVerification(verification.id, status, output)
  })
}

function syncAttempts(runId: string): RunAttempt[] {
  const attempts = specRunsStore.listAttempts(runId).map((attempt) => {
    if (!attempt.sessionId) return attempt

    const session = sessionsStore.get(attempt.sessionId)
    if (!session) return attempt

    const nextStatus = attemptStatusFromSession(session.status)
    if (nextStatus === attempt.status) return attempt

    return specRunsStore.updateAttempt(attempt.id, {
      status: nextStatus,
      costUsd: session.costUsd,
    })
  })

  const run = specRunsStore.get(runId)
  if (run?.status === 'running' && attempts.length > 0 && attempts.every(isTerminalAttempt)) {
    specRunsStore.complete(
      runId,
      attempts.every((attempt) => attempt.status === 'done') ? 'done' : 'failed',
    )
  }

  return attempts
}

function attemptStatusFromSession(status: SessionStatus): RunAttemptStatus {
  if (status === 'done') return 'done'
  if (status === 'error') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return 'running'
}

function isTerminalAttempt(attempt: RunAttempt): boolean {
  return attempt.status === 'done' || attempt.status === 'failed' || attempt.status === 'cancelled'
}

function isReviewableRun(status: string): boolean {
  return status === 'done' || status === 'reviewing' || status === 'verified'
}

function formatSpecPrompt(spec: NonNullable<ReturnType<typeof specsStore.get>>): string {
  const requirements = spec.requirements.map((item) => `- ${item.body}`).join('\n')
  const criteria = spec.acceptanceCriteria.map((item) => `- ${item.body}`).join('\n')
  const targets = spec.targetFiles.map((item) => `- ${item}`).join('\n')

  return [
    `Implement the approved spec: ${spec.title}`,
    '',
    'Goal:',
    spec.goal,
    '',
    'Context:',
    spec.context || 'No additional context.',
    '',
    'Constraints:',
    spec.constraints || 'No additional constraints.',
    '',
    'Requirements:',
    requirements || '- No explicit requirements.',
    '',
    'Acceptance criteria:',
    criteria || '- No explicit acceptance criteria.',
    '',
    'Done when:',
    spec.doneWhen || 'The implementation is complete, reviewed, and verified.',
    '',
    'Target files:',
    targets || '- Agent may inspect the repo and choose the relevant files.',
  ].join('\n')
}

function runVerificationCommand(
  command: string,
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('zsh', ['-lc', command], {
      cwd,
      env: buildProcessEnvironment(),
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
        stderr: `${stderr}\nVerification timed out after ${VERIFICATION_TIMEOUT_MS / 1000}s.`,
      })
    }, VERIFICATION_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = truncateOutput(stdout + chunk.toString())
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = truncateOutput(stderr + chunk.toString())
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

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output

  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]`
}
