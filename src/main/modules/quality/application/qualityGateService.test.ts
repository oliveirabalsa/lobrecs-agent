import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../settings'
import type { AgentActivity, AppSettings, DiffProposal } from '../../../../shared/types'
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
        routeModel: vi.fn(),
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
    const dispatchRepair = vi.fn<QualityGateDependencies['dispatchRepair']>(
      async (input) => {
        repairPrompts.push(input.prompt)
        return { sessionId: 'repair-1' }
      },
    )
    const routeModel = vi.fn<QualityGateDependencies['routeModel']>(async () => ({
      agentId: 'claude-code' as const,
      model: 'claude-sonnet-4-6',
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
        runCommand: vi.fn<RunCommand>(async (command) =>
          command.includes('build')
            ? { exitCode: 1, stdout: '', stderr: 'Type error' }
            : { exitCode: 0, stdout: 'ok', stderr: '' },
        ),
      },
    )

    expect(routeModel).toHaveBeenCalledTimes(1)
    expect(dispatchRepair).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        threadId: 'thread-1',
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
