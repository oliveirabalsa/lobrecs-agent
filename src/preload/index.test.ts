import { describe, expect, it, vi } from 'vitest'
import { createAgentForgeApi, type AgentForgeApi } from './api'
import type { AgentEvent } from '../shared/contracts/sessions'
import type { SettingsUpdateEvent } from '../shared/contracts/settings'
import type { SwarmConfig } from '../shared/contracts/swarms'
import type { ThreadDeletedEvent } from '../shared/contracts/threads'

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
      'threads',
      'agent',
      'swarm',
      'router',
      'feedback',
      'cost',
      'automations',
      'specs',
      'runs',
      'git',
      'settings',
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
          agentforge.sessions.listThreadTranscript('thread-1', { limit: 4 }),
        expected: ['sessions:list-thread-transcript', 'thread-1', { limit: 4 }],
      },
      {
        call: (agentforge) => agentforge.threads.list('project-1'),
        expected: ['threads:list', 'project-1', undefined],
      },
      {
        call: (agentforge) => agentforge.threads.list('project-1', { includeArchived: true }),
        expected: ['threads:list', 'project-1', { includeArchived: true }],
      },
      {
        call: (agentforge) => agentforge.threads.get('thread-1'),
        expected: ['threads:get', 'thread-1'],
      },
      {
        call: (agentforge) => agentforge.threads.search({ query: 'diff', limit: 12 }),
        expected: ['threads:search', { query: 'diff', limit: 12 }],
      },
      {
        call: (agentforge) =>
          agentforge.threads.create({ projectId: 'project-1', title: 'New thread' }),
        expected: ['threads:create', { projectId: 'project-1', title: 'New thread' }],
      },
      {
        call: (agentforge) =>
          agentforge.threads.rename({ id: 'thread-1', title: 'Renamed' }),
        expected: ['threads:rename', { id: 'thread-1', title: 'Renamed' }],
      },
      {
        call: (agentforge) => agentforge.threads.delete('thread-1'),
        expected: ['threads:delete', 'thread-1'],
      },
      {
        call: (agentforge) => agentforge.threads.pin({ id: 'thread-1', pinned: true }),
        expected: ['threads:pin', { id: 'thread-1', pinned: true }],
      },
      {
        call: (agentforge) => agentforge.threads.archive('thread-1'),
        expected: ['threads:archive', 'thread-1'],
      },
      {
        call: (agentforge) =>
          agentforge.agent.dispatch({
            projectId: 'project-1',
            prompt: 'Ship it',
            agentId: 'codex',
            modelOverride: 'gpt-5.3-codex',
          }),
        expected: [
          'agent:dispatch',
          {
            projectId: 'project-1',
            prompt: 'Ship it',
            agentId: 'codex',
            modelOverride: 'gpt-5.3-codex',
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
        call: (agentforge) => agentforge.specs.list('project-1'),
        expected: ['specs:list', 'project-1'],
      },
      {
        call: (agentforge) =>
          agentforge.specs.create({
            projectId: 'project-1',
            title: 'Spec',
            goal: 'Implement the work',
          }),
        expected: [
          'specs:create',
          {
            projectId: 'project-1',
            title: 'Spec',
            goal: 'Implement the work',
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.specs.update('spec-1', { goal: 'Refine the goal' }),
        expected: ['specs:update', 'spec-1', { goal: 'Refine the goal' }],
      },
      {
        call: (agentforge) => agentforge.specs.get('spec-1'),
        expected: ['specs:get', 'spec-1'],
      },
      {
        call: (agentforge) => agentforge.specs.approve('spec-1'),
        expected: ['specs:approve', 'spec-1'],
      },
      {
        call: (agentforge) => agentforge.runs.start({ specId: 'spec-1', mode: 'worktree' }),
        expected: ['runs:start', { specId: 'spec-1', mode: 'worktree' }],
      },
      {
        call: (agentforge) => agentforge.runs.cancel('run-1'),
        expected: ['runs:cancel', 'run-1'],
      },
      {
        call: (agentforge) => agentforge.runs.compare('spec-1'),
        expected: ['runs:compare', 'spec-1'],
      },
      {
        call: (agentforge) => agentforge.runs.verify('run-1', 'rtk npm run build'),
        expected: ['runs:verify', 'run-1', 'rtk npm run build'],
      },
      {
        call: (agentforge) => agentforge.git.diff({ projectId: 'project-1' }),
        expected: ['git:diff', { projectId: 'project-1' }],
      },
      {
        call: (agentforge) =>
          agentforge.git.stage({ projectId: 'project-1', paths: ['src/main.ts'] }),
        expected: ['git:stage', { projectId: 'project-1', paths: ['src/main.ts'] }],
      },
      {
        call: (agentforge) =>
          agentforge.git.revert({ projectId: 'project-1', paths: ['src/main.ts'] }),
        expected: ['git:revert', { projectId: 'project-1', paths: ['src/main.ts'] }],
      },
      {
        call: (agentforge) =>
          agentforge.git.commit({ projectId: 'project-1', message: 'feat: add spec' }),
        expected: ['git:commit', { projectId: 'project-1', message: 'feat: add spec' }],
      },
      {
        call: (agentforge) => agentforge.git.push('project-1'),
        expected: ['git:push', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.settings.getGlobal(),
        expected: ['settings:get-global'],
      },
      {
        call: (agentforge) =>
          agentforge.settings.updateGlobal({ ui: { compactMode: true } }),
        expected: ['settings:update-global', { ui: { compactMode: true } }],
      },
      {
        call: (agentforge) => agentforge.settings.getEffective('project-1'),
        expected: ['settings:get-effective', 'project-1'],
      },
      {
        call: (agentforge) => agentforge.settings.getProjectOverrides('project-1'),
        expected: ['settings:get-project-overrides', 'project-1'],
      },
      {
        call: (agentforge) =>
          agentforge.settings.updateProjectOverrides('project-1', {
            swarms: { maxAgents: 4 },
          }),
        expected: [
          'settings:update-project-overrides',
          'project-1',
          { swarms: { maxAgents: 4 } },
        ],
      },
      {
        call: (agentforge) => agentforge.settings.resetProjectOverrides('project-1'),
        expected: ['settings:reset-project-overrides', 'project-1'],
      },
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
      {
        call: (agentforge) => agentforge.system.listCapabilities(),
        expected: ['system:list-capabilities'],
      },
      {
        call: (agentforge) => agentforge.system.listVerificationRecipes('project-1'),
        expected: ['system:list-verification-recipes', 'project-1'],
      },
      {
        call: (agentforge) =>
          agentforge.system.saveImageAttachment({
            dataUrl: 'data:image/png;base64,AAAA',
            name: 'paste.png',
            mimeType: 'image/png',
          }),
        expected: [
          'system:save-image-attachment',
          {
            dataUrl: 'data:image/png;base64,AAAA',
            name: 'paste.png',
            mimeType: 'image/png',
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.system.startCliEditorTerminal({
            sessionId: 'terminal-1',
            editorId: 'vim',
            repoPath: '/tmp/repo',
            cols: 120,
            rows: 40,
          }),
        expected: [
          'system:start-cli-editor-terminal',
          {
            sessionId: 'terminal-1',
            editorId: 'vim',
            repoPath: '/tmp/repo',
            cols: 120,
            rows: 40,
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.system.writeCliEditorTerminal({
            sessionId: 'terminal-1',
            data: ':q\r',
          }),
        expected: [
          'system:write-cli-editor-terminal',
          {
            sessionId: 'terminal-1',
            data: ':q\r',
          },
        ],
      },
      {
        call: (agentforge) =>
          agentforge.system.resizeCliEditorTerminal({
            sessionId: 'terminal-1',
            cols: 100,
            rows: 32,
          }),
        expected: [
          'system:resize-cli-editor-terminal',
          {
            sessionId: 'terminal-1',
            cols: 100,
            rows: 32,
          },
        ],
      },
      {
        call: (agentforge) => agentforge.system.stopCliEditorTerminal('terminal-1'),
        expected: ['system:stop-cli-editor-terminal', 'terminal-1'],
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

  it('keeps cli editor terminal subscription cleanup behavior', () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )
    const dataEvent = {
      sessionId: 'terminal-1',
      data: 'ready',
    }
    const exitEvent = {
      sessionId: 'terminal-1',
      exitCode: 0,
    }
    const dataCallback = vi.fn()
    const exitCallback = vi.fn()

    const unsubscribeData = api.system.onCliEditorTerminalData(dataCallback)
    const unsubscribeExit = api.system.onCliEditorTerminalExit(exitCallback)
    ipcRenderer.emit('system:cli-editor-terminal:data', dataEvent)
    ipcRenderer.emit('system:cli-editor-terminal:exit', exitEvent)

    expect(dataCallback).toHaveBeenCalledWith(dataEvent)
    expect(exitCallback).toHaveBeenCalledWith(exitEvent)
    expect(ipcRenderer.on).toHaveBeenCalledWith(
      'system:cli-editor-terminal:data',
      expect.any(Function),
    )
    expect(ipcRenderer.on).toHaveBeenCalledWith(
      'system:cli-editor-terminal:exit',
      expect.any(Function),
    )

    dataCallback.mockClear()
    exitCallback.mockClear()
    unsubscribeData()
    unsubscribeExit()
    ipcRenderer.emit('system:cli-editor-terminal:data', dataEvent)
    ipcRenderer.emit('system:cli-editor-terminal:exit', exitEvent)

    expect(dataCallback).not.toHaveBeenCalled()
    expect(exitCallback).not.toHaveBeenCalled()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'system:cli-editor-terminal:data',
      expect.any(Function),
    )
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'system:cli-editor-terminal:exit',
      expect.any(Function),
    )
  })

  it('keeps thread deletion subscription cleanup behavior', () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )
    const event: ThreadDeletedEvent = {
      threadId: 'thread-1',
      projectId: 'project-1',
    }
    const callback = vi.fn()

    const unsubscribe = api.threads.onDeleted(callback)
    ipcRenderer.emit('thread:deleted', event)

    expect(callback).toHaveBeenCalledWith(event)
    expect(ipcRenderer.on).toHaveBeenCalledWith('thread:deleted', expect.any(Function))

    callback.mockClear()
    unsubscribe()
    ipcRenderer.emit('thread:deleted', event)

    expect(callback).not.toHaveBeenCalled()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'thread:deleted',
      expect.any(Function),
    )
  })

  it('keeps settings subscription cleanup behavior', () => {
    const ipcRenderer = createIpcRendererMock()
    const api = createAgentForgeApi(
      ipcRenderer as unknown as Parameters<typeof createAgentForgeApi>[0],
    )
    const event: SettingsUpdateEvent = {
      scope: 'global',
      settings: {} as SettingsUpdateEvent['settings'],
      effective: {} as SettingsUpdateEvent['effective'],
      updatedAt: 1,
    }
    const callback = vi.fn()

    const unsubscribe = api.settings.onUpdated(callback)
    ipcRenderer.emit('settings:updated', event)

    expect(callback).toHaveBeenCalledWith(event)
    expect(ipcRenderer.on).toHaveBeenCalledWith('settings:updated', expect.any(Function))

    callback.mockClear()
    unsubscribe()
    ipcRenderer.emit('settings:updated', event)

    expect(callback).not.toHaveBeenCalled()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'settings:updated',
      expect.any(Function),
    )
  })
})
