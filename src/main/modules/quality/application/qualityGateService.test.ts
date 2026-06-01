import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../settings'
import type { AgentActivity, AppSettings, DiffProposal, SupportedAgentId } from '../../../../shared/types'
import { runQualityGate, type QualityGateDependencies } from './qualityGateService'

type RunCommand = NonNullable<QualityGateDependencies['runCommand']>

describe('runQualityGate', () => {
  it('runs configured verification recipes for applied changes', async () => {
    const activities: AgentActivity[] = []
    const commands: string[] = []
    const runCommand = vi.fn<RunCommand>(async (command) => {
      commands.push(command)
      return { exitCode: 0, stdout: 'ok', stderr: '' }
    })

    await runQualityGate(
      {
        sessionId: 'session-1',
        threadId: 'thread-1',
        projectId: 'project-1',
        repoPath: '/repo',
        changedFiles: [appliedProposal('/repo/src/app.ts')],
        attempt: 0,
        emitActivity: (activity) => activities.push(activity),
      },
      {
        getSettings: () => DEFAULT_APP_SETTINGS,
        routeModel: vi.fn(),
        dispatchRepair: vi.fn(),
        runCommand,
      },
    )

    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(commands).toEqual(['rtk npm run build', 'rtk npm test'])
    expect(activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'step', title: 'Automated QA started' }),
        expect.objectContaining({ kind: 'step', title: 'Automated QA passed' }),
      ]),
    )
  })

  it('runs verification commands with the system shell when no custom runner is provided', async () => {
    const activities: AgentActivity[] = []
    const settings: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      specs: {
        ...DEFAULT_APP_SETTINGS.specs,
        defaultVerificationRecipeIds: ['shell-smoke'],
      },
      verification: {
        ...DEFAULT_APP_SETTINGS.verification,
        requireCommandPrefix: false,
        recipes: [
          {
            id: 'shell-smoke',
            label: 'Shell Smoke',
            command: 'node -e "process.stdout.write(\'quality-ok\')"',
            scope: 'custom',
          },
        ],
      },
    }

    await runQualityGate(
      {
        sessionId: 'session-1',
        threadId: 'thread-1',
        projectId: 'project-1',
        repoPath: process.cwd(),
        changedFiles: [appliedProposal(`${process.cwd()}/src/main/app.ts`)],
        attempt: 0,
        emitActivity: (activity) => activities.push(activity),
      },
      {
        getSettings: () => settings,
        routeModel: vi.fn<QualityGateDependencies['routeModel']>(async (input) => ({
          agentId: input.preferredAgentId,
          model: 'test-model',
        })),
        dispatchRepair: vi.fn(),
      },
    )

    expect(activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'step', title: 'Automated QA started' }),
        expect.objectContaining({ kind: 'step', title: 'Automated QA passed' }),
      ]),
    )
    expect(activities).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'step', title: 'Automated QA failed' })]),
    )
  })

  it('dispatches one repair session when verification fails', async () => {
    const activities: AgentActivity[] = []
    const repairPrompts: string[] = []
    const auditEvents: Parameters<NonNullable<QualityGateDependencies['recordAudit']>>[0][] = []
    const dispatchRepair = vi.fn<QualityGateDependencies['dispatchRepair']>(
      async (input) => {
        repairPrompts.push(input.prompt)
        return { sessionId: 'repair-1' }
      },
    )
    const routeModel = vi.fn<QualityGateDependencies['routeModel']>(async (input) => ({
      agentId: input.preferredAgentId,
      model: modelForAgent(input.preferredAgentId),
    }))

    await runQualityGate(
      {
        sessionId: 'session-1',
        threadId: 'thread-1',
        projectId: 'project-1',
        repoPath: '/repo',
        changedFiles: [appliedProposal('/repo/src/app.ts')],
        attempt: 0,
        emitActivity: (activity) => activities.push(activity),
      },
      {
        getSettings: () => DEFAULT_APP_SETTINGS,
        routeModel,
        dispatchRepair,
        recordAudit: (event) => auditEvents.push(event),
        runCommand: vi.fn<RunCommand>(async (command) =>
          command.includes('build')
            ? { exitCode: 1, stdout: '', stderr: 'Type error' }
            : { exitCode: 0, stdout: 'ok', stderr: '' },
        ),
      },
    )

    expect(auditEvents.map((event) => event.phase)).toEqual([
      'recipe-started',
      'recipe-failed',
      'repair-dispatched',
    ])
    expect(auditEvents.at(-1)).toMatchObject({
      phase: 'repair-dispatched',
      repairSessionId: 'repair-1',
      exitCode: 1,
    })

    expect(routeModel).toHaveBeenCalledTimes(1)
    expect(routeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredAgentId: 'codex',
      }),
    )
    expect(dispatchRepair).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        threadId: 'thread-1',
        agentId: 'codex',
        model: 'gpt-5.3-codex',
        qualityAttempt: 1,
      }),
    )
    expect(repairPrompts.at(0)).toContain('Type error')
    expect(activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'step', title: 'Automated QA failed' }),
        expect.objectContaining({ kind: 'step', title: 'Self-healing repair started' }),
      ]),
    )
  })

  it('keeps trying repair agents when the router falls back to Claude first', async () => {
    const dispatchRepair = vi.fn<QualityGateDependencies['dispatchRepair']>(
      async () => ({ sessionId: 'repair-1' }),
    )
    const routeModel = vi.fn<QualityGateDependencies['routeModel']>(async (input) => {
      if (input.preferredAgentId === 'codex') {
        return { agentId: 'claude-code', model: 'claude-sonnet-4-6' }
      }

      return { agentId: 'opencode', model: 'minimax/MiniMax-M2' }
    })

    await runQualityGate(
      {
        sessionId: 'session-1',
        threadId: 'thread-1',
        projectId: 'project-1',
        repoPath: '/repo',
        changedFiles: [appliedProposal('/repo/src/app.ts')],
        attempt: 0,
        emitActivity: vi.fn(),
      },
      {
        getSettings: () => DEFAULT_APP_SETTINGS,
        routeModel,
        dispatchRepair,
        runCommand: vi.fn<RunCommand>(async (command) =>
          command.includes('build')
            ? { exitCode: 1, stdout: '', stderr: 'Type error' }
            : { exitCode: 0, stdout: 'ok', stderr: '' },
        ),
      },
    )

    expect(routeModel).toHaveBeenCalledTimes(2)
    expect(routeModel.mock.calls.map(([input]) => input.preferredAgentId)).toEqual([
      'codex',
      'opencode',
    ])
    expect(dispatchRepair).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'opencode',
        model: 'minimax/MiniMax-M2',
      }),
    )
  })

  it('stops self-healing when the same recipe fails twice with the same exit code', async () => {
    const auditEvents: Parameters<NonNullable<QualityGateDependencies['recordAudit']>>[0][] = []
    const dispatchRepair = vi.fn()
    const settings: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      verification: {
        ...DEFAULT_APP_SETTINGS.verification,
        selfHealingMaxAttempts: 3,
      },
    }

    await runQualityGate(
      {
        sessionId: 'session-1',
        threadId: 'thread-1',
        projectId: 'project-1',
        repoPath: '/repo',
        changedFiles: [appliedProposal('/repo/src/app.ts')],
        attempt: 1,
        emitActivity: vi.fn(),
      },
      {
        getSettings: () => settings,
        routeModel: vi.fn(),
        dispatchRepair,
        recordAudit: (event) => auditEvents.push(event),
        getLastAudit: () => ({ recipeId: 'build', exitCode: 1, phase: 'recipe-failed' }),
        runCommand: vi.fn<RunCommand>(async (command) =>
          command.includes('build')
            ? { exitCode: 1, stdout: '', stderr: 'Type error' }
            : { exitCode: 0, stdout: 'ok', stderr: '' },
        ),
      },
    )

    expect(dispatchRepair).not.toHaveBeenCalled()
    expect(auditEvents.at(-1)).toMatchObject({
      phase: 'gate-stopped',
      stopReason: 'repeat-failure',
      finalStatus: 'failed',
      recipeId: 'build',
      exitCode: 1,
    })
  })

  it('does not dispatch another repair after the configured attempt limit', async () => {
    const settings: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      verification: {
        ...DEFAULT_APP_SETTINGS.verification,
        selfHealingMaxAttempts: 1,
      },
    }
    const dispatchRepair = vi.fn()

    await runQualityGate(
      {
        sessionId: 'session-1',
        threadId: 'thread-1',
        projectId: 'project-1',
        repoPath: '/repo',
        changedFiles: [appliedProposal('/repo/src/app.ts')],
        attempt: 1,
        emitActivity: vi.fn(),
      },
      {
        getSettings: () => settings,
        routeModel: vi.fn(),
        dispatchRepair,
        runCommand: vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'Still failing' })),
      },
    )

    expect(dispatchRepair).not.toHaveBeenCalled()
  })

  it('skips repair dispatch when another repair is already in flight', async () => {
    const activities: AgentActivity[] = []
    const auditEvents: Parameters<NonNullable<QualityGateDependencies['recordAudit']>>[0][] = []
    const dispatchRepair = vi.fn()

    await runQualityGate(
      {
        sessionId: 'session-1',
        threadId: 'thread-1',
        projectId: 'project-1',
        repoPath: '/repo',
        changedFiles: [appliedProposal('/repo/src/app.ts')],
        attempt: 0,
        emitActivity: (activity) => activities.push(activity),
      },
      {
        getSettings: () => DEFAULT_APP_SETTINGS,
        routeModel: vi.fn(),
        dispatchRepair,
        recordAudit: (event) => auditEvents.push(event),
        isRepairInFlight: () => true,
        runCommand: vi.fn<RunCommand>(async (command) =>
          command.includes('build')
            ? { exitCode: 1, stdout: '', stderr: 'Build failed' }
            : { exitCode: 0, stdout: 'ok', stderr: '' },
        ),
      },
    )

    expect(dispatchRepair).not.toHaveBeenCalled()
    expect(auditEvents.at(-1)).toMatchObject({
      phase: 'gate-stopped',
      stopReason: 'repair-in-flight',
      finalStatus: 'failed',
      recipeId: 'build',
      exitCode: 1,
    })
    expect(activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'step',
          title: 'Self-healing skipped',
          detail: expect.stringContaining('Another repair session is already running'),
          status: 'error',
        }),
      ]),
    )
  })
})

function appliedProposal(filePath: string): DiffProposal {
  return {
    filePath,
    originalContent: '',
    proposedContent: 'changed',
    changeType: 'modified',
    status: 'applied',
  }
}

function modelForAgent(agentId: SupportedAgentId): string {
  if (agentId === 'codex') return 'gpt-5.3-codex'
  if (agentId === 'opencode') return 'minimax/MiniMax-M2'
  if (agentId === 'antigravity') return 'gemini-3.0-pro'
  return 'claude-sonnet-4-6'
}
