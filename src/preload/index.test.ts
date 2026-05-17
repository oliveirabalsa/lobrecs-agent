import { describe, expect, it, vi } from 'vitest'
import { createAgentForgeApi, type AgentForgeApi } from './api'
import type { AgentEvent } from '../shared/contracts/sessions'
import type { SwarmConfig } from '../shared/contracts/swarms'

type IpcListener = (event: unknown, payload?: unknown) => void

function createIpcRendererMock() {
  const listeners = new Map<string, IpcListener[]>()

  const ipcRenderer = {
    invoke: vi.fn(() => Promise.resolve(undefined)),
    on: vi.fn((event: string, listener: IpcListener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return ipcRenderer
    }),
    removeListener: vi.fn((event: string, listener: IpcListener) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((item) => item !== listener),
      )
      return ipcRenderer
    }),
    emit: (event: string, payload?: unknown) => {
      for (const listener of listeners.get(event) ?? []) {
        listener({}, payload)
      }
    },
  }

  return ipcRenderer
}

describe('preload api shape', () => {
  it('keeps the renderer-facing API grouped by feature', () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )

    expect(Object.keys(api)).toEqual([
      'projects',
      'sessions',
      'agent',
      'swarm',
      'router',
      'feedback',
      'cost',
      'automations',
      'diff',
      'on',
      'onShortcut',
      'system',
    ])
  })

  it('keeps existing invoke channel mappings', async () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )
    const projectInput = {
      name: 'Lobrecs',
      repoPath: '/tmp/lobrecs',
      agentId: 'codex' as const,
      modelTier: 'balanced' as const,
    }
    const automationInput = {
      projectId: 'project-1',
      name: 'Nightly review',
      prompt: 'Review current branch',
      schedule: '0 9 * * *',
      agentId: 'codex' as const,
      enabled: true,
    }
    const swarmConfig: SwarmConfig = {
      projectId: 'project-1',
      prompt: 'Refactor safely',
      strategy: 'parallel',
      agents: [{ role: 'reviewer', agentId: 'codex' }],
    }
    const cases: Array<{
      call: (agentforge: AgentForgeApi) => Promise<unknown>
      expected: unknown[]
    }> = [
      { call: (agentforge) => agentforge.projects.list(), expected: ['projects:list'] },
      {
        call: (agentforge) => agentforge.projects.create(projectInput),
        expected: ['projects:create', projectInput],
      },
      {
        call: (agentforge) => agentforge.projects.update('project-1', { name: 'Next' }),
        expected: ['projects:update', 'project-1', { name: 'Next' }],
      },
      {
        call: (agentforge) => agentforge.projects.delete('project-1'),
        expected: ['projects:delete', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.sessions.list('project-1'),
        expected: ['sessions:list', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.sessions.get('session-1'),
        expected: ['sessions:get', 'session-1'],
      },
      {
        call: (agentforge) => agentforge.sessions.fork('session-1'),
        expected: ['sessions:fork', 'session-1'],
      },
      {
        call: (agentforge) => agentforge.sessions.listEvents('session-1'),
        expected: ['sessions:list-events', 'session-1'],
      },
      {
        call: (agentforge) =>
          agentforge.agent.dispatch({
            projectId: 'project-1',
            prompt: 'Ship it',
            agentId: 'codex',
            modelOverride: 'gpt-5.2-codex',
          }),
        expected: [
          'agent:dispatch',
          {
            projectId: 'project-1',
            prompt: 'Ship it',
            agentId: 'codex',
            modelOverride: 'gpt-5.2-codex',
          },
        ],
      },
      {
        call: (agentforge) => agentforge.agent.approve('session-1'),
        expected: ['agent:approve', 'session-1'],
      },
      {
        call: (agentforge) => agentforge.agent.reject('session-1'),
        expected: ['agent:reject', 'session-1'],
      },
      {
        call: (agentforge) => agentforge.agent.cancel('session-1'),
        expected: ['agent:cancel', 'session-1'],
      },
      { call: (agentforge) => agentforge.agent.killAll(), expected: ['agent:kill-all'] },
      {
        call: (agentforge) => agentforge.swarm.spawn(swarmConfig),
        expected: ['swarm:spawn', swarmConfig],
      },
      {
        call: (agentforge) => agentforge.swarm.status('swarm-1'),
        expected: ['swarm:status', 'swarm-1'],
      },
      {
        call: (agentforge) => agentforge.swarm.cancel('swarm-1'),
        expected: ['swarm:cancel', 'swarm-1'],
      },
      {
        call: (agentforge) => agentforge.swarm.applyResult('session-1', '/tmp/repo'),
        expected: ['swarm:apply-result', 'session-1', '/tmp/repo'],
      },
      {
        call: (agentforge) => agentforge.router.preview('Refactor safely', 'project-1'),
        expected: ['router:preview', 'Refactor safely', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.feedback.save('session-1', 'success', 'Looks good'),
        expected: ['feedback:save', 'session-1', 'success', 'Looks good'],
      },
      {
        call: (agentforge) => agentforge.cost.byProject('project-1'),
        expected: ['cost:by-project', 'project-1'],
      },
      { call: (agentforge) => agentforge.cost.byPeriod(30), expected: ['cost:by-period', 30] },
      {
        call: (agentforge) => agentforge.automations.list('project-1'),
        expected: ['automations:list', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.automations.create(automationInput),
        expected: ['automations:create', automationInput],
      },
      {
        call: (agentforge) =>
          agentforge.automations.update('automation-1', { enabled: false }),
        expected: ['automations:update', 'automation-1', { enabled: false }],
      },
      {
        call: (agentforge) => agentforge.automations.delete('automation-1'),
        expected: ['automations:delete', 'automation-1'],
      },
      {
        call: (agentforge) => agentforge.automations.runNow('automation-1'),
        expected: ['automations:run-now', 'automation-1'],
      },
      {
        call: (agentforge) => agentforge.diff.apply('/tmp/file.ts', 'content'),
        expected: ['diff:apply', '/tmp/file.ts', 'content'],
      },
      { call: (agentforge) => agentforge.diff.reject(), expected: ['diff:reject'] },
      {
        call: (agentforge) => agentforge.system.openInEditor('/tmp/file.ts'),
        expected: ['system:open-editor', '/tmp/file.ts'],
      },
      {
        call: (agentforge) => agentforge.system.selectDirectory(),
        expected: ['system:select-directory'],
      },
      {
        call: (agentforge) => agentforge.system.checkAgentInstalled('codex'),
        expected: ['system:check-agent', 'codex'],
      },
      {
        call: (agentforge) => agentforge.system.listAgentModels(),
        expected: ['system:list-agent-models'],
      },
    ]

    for (const { call, expected } of cases) {
      ipcRenderer.invoke.mockClear()

      await call(api)

      expect(ipcRenderer.invoke).toHaveBeenCalledWith(...expected)
    }
  })

  it('keeps event subscription cleanup behavior', () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )
    const event: AgentEvent = {
      type: 'stdout',
      sessionId: 'session-1',
      payload: 'ready',
      timestamp: 1,
    }
    const callback = vi.fn()

    const unsubscribe = api.on('session:session-1', callback)
    ipcRenderer.emit('session:session-1', event)

    expect(callback).toHaveBeenCalledWith(event)
    expect(ipcRenderer.on).toHaveBeenCalledWith('session:session-1', expect.any(Function))

    callback.mockClear()
    unsubscribe()
    ipcRenderer.emit('session:session-1', event)

    expect(callback).not.toHaveBeenCalled()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'session:session-1',
      expect.any(Function),
    )
  })

  it('keeps shortcut subscription cleanup behavior', () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )
    const callback = vi.fn()

    const unsubscribe = api.onShortcut('shortcut:approve', callback)
    ipcRenderer.emit('shortcut:approve')

    expect(callback).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.on).toHaveBeenCalledWith('shortcut:approve', expect.any(Function))

    callback.mockClear()
    unsubscribe()
    ipcRenderer.emit('shortcut:approve')

    expect(callback).not.toHaveBeenCalled()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'shortcut:approve',
      expect.any(Function),
    )
  })
})
