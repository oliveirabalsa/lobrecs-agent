import { ipcMain } from 'electron'
import {
  hasRequiredCommandPrefix,
  runVerificationCommand,
} from '../../../process/verification'
import {
  getAgentProfile,
  promptWithAgentProfile,
} from '../../agents/application/agentProfileService'
import {
  runtimeSettingsWithApprovalMode,
  runtimeSettingsWithThinkingLevel,
} from '../../agents/domain/approvalMode'
import {
  validateRunId,
  validateCaptureLocalWebVisualEvidenceInput,
  validateSessionId,
  validateSpecId,
  validateStartSpecRunInput,
  validateVerificationCommand,
} from '../../../../shared/types'
import { captureLocalWebVisualEvidence } from '../../quality/infrastructure/localWebVisualEvidenceService'
import {
  projectsStore,
  promptEvidenceStore,
  runAuditStore,
  sessionsStore,
  specRunsStore,
  specsStore,
} from '../../../store'
import type { MainIpcContext } from '../../shared/ipcContext'
import type {
  RunAttempt,
  RunAttemptStatus,
  SessionStatus,
  StartSpecRunInput,
} from '../../../../shared/types'

export function registerRunHandlers(context: MainIpcContext): void {
  ipcMain.handle('runs:start', async (_event, rawInput: unknown) => {
    const input: StartSpecRunInput = validateStartSpecRunInput(rawInput)
    const spec = specsStore.get(input.specId)
    if (!spec) throw new Error(`Spec not found: ${input.specId}`)

    const project = projectsStore.get(spec.projectId)
    if (!project) throw new Error(`Project not found: ${spec.projectId}`)
    const runMode = 'local'
    const settings = context.settingsService.getEffective(project.id).settings

    const { run, attempts } = specRunsStore.start(spec.id, runMode)
    const prompt = formatSpecPrompt(spec)

    for (const [attemptIndex, attempt] of attempts.entries()) {
      try {
        const profileId = spec.selectedAgentProfiles[attemptIndex]
        const profile = await getAgentProfile(project.id, profileId)
        const attemptPrompt = promptWithAgentProfile(prompt, profile)
        const route = await context.modelRouter.route({
          prompt: attemptPrompt,
          preferredAgentId: profile?.defaultAgentId ?? attempt.agentId,
          modelOverride: profile?.defaultModel,
        })
        specRunsStore.updateAttempt(attempt.id, {
          model: route.model,
          status: 'running',
        })
        const { sessionId } = await context.sessionManager.dispatch({
          projectId: project.id,
          prompt: attemptPrompt,
          agentId: route.agentId,
          model: route.model,
          repoPath: project.repoPath,
          context: projectsStore.getContext(project.id),
          isolate: false,
          runtimeSettings: runtimeSettingsWithApprovalMode(
            runtimeSettingsWithThinkingLevel(
              settings.agents.runtimes[route.agentId],
              route.agentId,
              profile?.thinking,
            ),
            profile?.approvalMode,
            settings.execution.defaultApprovalMode,
          ),
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

  ipcMain.handle('runs:cancel', async (_event, rawRunId: unknown) => {
    const runId = validateRunId(rawRunId)
    for (const attempt of specRunsStore.listAttempts(runId)) {
      if (attempt.sessionId && !isTerminalAttempt(attempt)) {
        context.sessionManager.cancel(attempt.sessionId)
      }
    }

    return specRunsStore.cancel(runId)
  })

  ipcMain.handle('runs:compare', async (_event, rawSpecId: unknown) => {
    const specId = validateSpecId(rawSpecId)
    const comparison = specRunsStore.compare(specId)
    for (const run of comparison.runs) {
      syncAttempts(run.id)
    }

    return specRunsStore.compare(specId)
  })

  ipcMain.handle('runs:verify', async (_event, rawRunId: unknown, rawCommand: unknown) => {
    const runId = validateRunId(rawRunId)
    const command = validateVerificationCommand(rawCommand)
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

    const settings = context.settingsService.getEffective(project.id).settings
    if (
      settings.verification.requireCommandPrefix &&
      !hasRequiredCommandPrefix(command, settings.execution.commandPrefix)
    ) {
      throw new Error(
        `Verification command must start with "${settings.execution.commandPrefix}".`,
      )
    }

    const verification = specRunsStore.createVerification(runId, command)
    const result = await runVerificationCommand(command, project.repoPath, {
      timeoutMs: settings.verification.defaultTimeoutSeconds * 1_000,
      maxOutputBytes: settings.verification.maxOutputBytes,
    })
    const status = result.exitCode === 0 ? 'passed' : 'failed'
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n\n')

    return specRunsStore.finishVerification(verification.id, status, output)
  })

  ipcMain.handle('runs:listAuditRecords', async (_event, rawRunId: unknown) => {
    const runId = validateRunId(rawRunId)
    return runAuditStore.listForSpecRun(runId)
  })

  ipcMain.handle('runs:listSessionAuditRecords', async (_event, rawSessionId: unknown) => {
    const sessionId = validateSessionId(rawSessionId)
    return runAuditStore.listForSession(sessionId)
  })

  ipcMain.handle(
    'runs:captureVisualEvidence',
    async (_event, rawSessionId: unknown, rawInput: unknown) => {
      const sessionId = validateSessionId(rawSessionId)
      const input = validateCaptureLocalWebVisualEvidenceInput(rawInput)
      const session = sessionsStore.get(sessionId)
      if (!session) throw new Error(`Session not found: ${sessionId}`)

      const visualEvidence = await captureLocalWebVisualEvidence(input)
      return runAuditStore.create({
        sessionId,
        threadId: session.threadId,
        specRunId: specRunsStore.findSpecRunIdBySessionId(sessionId) ?? undefined,
        attempt: 0,
        phase: visualEvidence.status === 'captured' ? 'visual-captured' : 'visual-failed',
        finalStatus: visualEvidence.status === 'captured' ? 'passed' : 'failed',
        visualEvidence,
      })
    },
  )

  ipcMain.handle('runs:getPromptEvidence', async (_event, rawSessionId: unknown) => {
    const sessionId = validateSessionId(rawSessionId)
    return promptEvidenceStore.getForSession(sessionId)
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
