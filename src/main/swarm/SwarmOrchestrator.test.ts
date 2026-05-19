import { describe, expect, it, vi } from 'vitest'
import type { SwarmConfig } from '../../shared/types'
import { DEFAULT_APP_SETTINGS } from '../modules/settings'
import {
  SwarmOrchestrator,
  createDefaultDependencies,
  type SwarmDispatchInput,
} from './SwarmOrchestrator'

describe('SwarmOrchestrator', () => {
  it('does not install a hidden plan confirmation in the default launch path', () => {
    expect(createDefaultDependencies().confirmPlan).toBeUndefined()
  })

  it('spawns parallel agents in the local project repo', async () => {
    const worktrees = createFakeWorktrees()
    const createThread = vi.fn(() => ({ id: 'thread-1' }))
    const dispatched: SwarmDispatchInput[] = []
    const orchestrator = new SwarmOrchestrator({
      getProject: async () => ({ id: 'project-1', repoPath: '/repo' }),
      createThread,
      routeModel: async (input) => ({
        agentId: input.preferredAgentId,
        model: input.modelOverride ?? 'claude-sonnet-4-6',
      }),
      dispatchSession: async (input) => {
        dispatched.push(input)
        return { sessionId: input.sessionId, status: 'running' }
      },
      worktrees,
    })

    const result = await orchestrator.spawn(baseConfig())

    expect(result.strategy).toBe('parallel')
    expect(result.threadId).toBe('thread-1')
    expect(result.sessions).toHaveLength(2)
    expect(result.sessions.map((session) => session.threadId)).toEqual(['thread-1', 'thread-1'])
    expect(createThread).toHaveBeenCalledWith({
      projectId: 'project-1',
      title: 'Swarm: Review the current codebase',
    })
    expect(worktrees.create).not.toHaveBeenCalled()
    expect(dispatched.map((call) => call.threadId)).toEqual(['thread-1', 'thread-1'])
    expect(dispatched.map((call) => call.repoPath)).toEqual(['/repo', '/repo'])
    expect(result.sessions.map((session) => session.worktreePath)).toEqual([null, null])
    expect(dispatched.map((call) => call.agentId)).toEqual(['claude-code', 'codex'])
    expect(dispatched.map((call) => call.model)).toEqual([
      'claude-sonnet-4-6',
      'gpt-5.3-codex',
    ])
    expect(dispatched[0].prompt).toContain('[Role: analyzer]')
    expect(dispatched[1].prompt).toContain('Check implementation quality')
  })

  it('routes each swarm role with its configured adapter and model hint', async () => {
    const worktrees = createFakeWorktrees()
    const dispatched: SwarmDispatchInput[] = []
    const routeInputs: Array<{ preferredAgentId: string; modelOverride?: string }> = []
    const orchestrator = new SwarmOrchestrator({
      getProject: async () => ({ id: 'project-1', repoPath: '/repo' }),
      createThread: () => ({ id: 'thread-1' }),
      routeModel: async (input) => {
        routeInputs.push({
          preferredAgentId: input.preferredAgentId,
          modelOverride: input.modelOverride,
        })

        return {
          agentId: input.preferredAgentId,
          model: input.modelOverride ?? `auto-${input.preferredAgentId}`,
        }
      },
      dispatchSession: async (input) => {
        dispatched.push(input)
        return { sessionId: input.sessionId, status: 'running' }
      },
      worktrees,
    })

    await orchestrator.spawn({
      projectId: 'project-1',
      prompt: 'Improve the codebase',
      strategy: 'parallel',
      agents: [
        { role: 'planner', agentId: 'claude-code' },
        { role: 'implementer', agentId: 'codex', modelOverride: 'gpt-5.3-codex' },
        { role: 'reviewer', agentId: 'opencode' },
      ],
    })

    expect(routeInputs).toEqual([
      { preferredAgentId: 'claude-code', modelOverride: undefined },
      { preferredAgentId: 'codex', modelOverride: 'gpt-5.3-codex' },
      { preferredAgentId: 'opencode', modelOverride: undefined },
    ])
    expect(dispatched.map((call) => call.agentId)).toEqual([
      'claude-code',
      'codex',
      'opencode',
    ])
    expect(dispatched.map((call) => call.model)).toEqual([
      'auto-claude-code',
      'gpt-5.3-codex',
      'auto-opencode',
    ])
    expect(new Set(dispatched.map((call) => call.agentId)).size).toBe(3)
    expect(worktrees.create).not.toHaveBeenCalled()
  })

  it('appends swarm agents to an existing thread without creating another chat', async () => {
    const worktrees = createFakeWorktrees()
    const createThread = vi.fn(() => ({ id: 'unexpected-thread' }))
    const dispatched: SwarmDispatchInput[] = []
    const orchestrator = new SwarmOrchestrator({
      getProject: async () => ({ id: 'project-1', repoPath: '/repo' }),
      createThread,
      routeModel: async (input) => ({
        agentId: input.preferredAgentId,
        model: input.modelOverride ?? 'claude-sonnet-4-6',
      }),
      dispatchSession: async (input) => {
        dispatched.push(input)
        return { sessionId: input.sessionId, threadId: input.threadId, status: 'running' }
      },
      worktrees,
    })

    const result = await orchestrator.spawn({
      ...baseConfig(),
      threadId: 'active-thread',
    })

    expect(result.threadId).toBe('active-thread')
    expect(result.sessions.map((session) => session.threadId)).toEqual([
      'active-thread',
      'active-thread',
    ])
    expect(dispatched.map((call) => call.threadId)).toEqual([
      'active-thread',
      'active-thread',
    ])
    expect(createThread).not.toHaveBeenCalled()
  })

  it('waits for sequential completion before launching the next agent prompt', async () => {
    const worktrees = createFakeWorktrees()
    const dispatched: SwarmDispatchInput[] = []
    const completions = new Map<string, Deferred<{ status: 'done'; output: string }>>()
    const orchestrator = new SwarmOrchestrator({
      getProject: () => ({ id: 'project-1', repoPath: '/repo' }),
      createThread: () => ({ id: 'thread-1' }),
      routeModel: (input) => ({ agentId: input.preferredAgentId, model: 'gpt-5.3-codex' }),
      dispatchSession: (input) => {
        dispatched.push(input)
        completions.set(input.sessionId, deferred<{ status: 'done'; output: string }>())
        return { sessionId: input.sessionId, threadId: input.threadId, status: 'running' }
      },
      waitForSessionCompletion: (sessionId) => completions.get(sessionId)!.promise,
      worktrees,
    })

    const result = await orchestrator.spawn({
      projectId: 'project-1',
      prompt: 'Review the current codebase',
      strategy: 'sequential',
      agents: [
        { role: 'analyzer', agentId: 'claude-code' },
        { role: 'implementer', agentId: 'codex', modelOverride: 'gpt-5.3-codex' },
      ],
    })

    expect(result.sessions).toHaveLength(1)
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].prompt).not.toContain('Context from previous step')
    completions.get(dispatched[0].sessionId)?.resolve({
      status: 'done',
      output: 'output from analyzer',
    })

    await waitFor(() => dispatched.length === 2)

    expect(dispatched.map((call) => call.threadId)).toEqual(['thread-1', 'thread-1'])
    expect(dispatched[1].prompt).toContain('Context from previous step')
    expect(dispatched[1].prompt).toContain('output from analyzer')
  })

  it('re-runs the implementer when the reviewer rejects, until approved', async () => {
    const worktrees = createFakeWorktrees()
    const dispatched: SwarmDispatchInput[] = []
    const completions = new Map<string, Deferred<{ status: 'done'; output: string }>>()
    const orchestrator = new SwarmOrchestrator({
      getProject: () => ({ id: 'project-1', repoPath: '/repo' }),
      createThread: () => ({ id: 'thread-1' }),
      routeModel: (input) => ({ agentId: input.preferredAgentId, model: 'claude-sonnet-4-6' }),
      dispatchSession: (input) => {
        dispatched.push(input)
        completions.set(input.sessionId, deferred<{ status: 'done'; output: string }>())
        return { sessionId: input.sessionId, threadId: input.threadId, status: 'running' }
      },
      waitForSessionCompletion: (sessionId) => completions.get(sessionId)!.promise,
      worktrees,
    })

    const result = await orchestrator.spawn({
      projectId: 'project-1',
      prompt: 'Add a /healthz endpoint',
      strategy: 'sequential',
      agents: [
        { role: 'implementer', agentId: 'codex' },
        { role: 'reviewer', agentId: 'claude-code' },
      ],
      maxIterations: 3,
    })

    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].role).toBe('implementer')
    expect(dispatched).toHaveLength(1)

    completions.get(dispatched[0].sessionId)?.resolve({
      status: 'done',
      output: 'first attempt: stub handler',
    })

    await waitFor(() => dispatched.length === 2)

    expect(dispatched[1].prompt).toContain('[Role: reviewer]')
    expect(dispatched[1].prompt).toContain('Implementation to review')
    expect(dispatched[1].prompt).toContain('first attempt: stub handler')
    expect(dispatched[1].prompt).toContain('VERDICT: APPROVED')

    completions.get(dispatched[1].sessionId)?.resolve({
      status: 'done',
      output: 'FEEDBACK: Return JSON with uptime\nVERDICT: REJECTED',
    })

    await waitFor(() => dispatched.length === 3)

    expect(dispatched[2].prompt).toContain('[Role: implementer]')
    expect(dispatched[2].prompt).toContain('Reviewer feedback to address')
    expect(dispatched[2].prompt).toContain('Return JSON with uptime')

    completions.get(dispatched[2].sessionId)?.resolve({
      status: 'done',
      output: 'second attempt: returns JSON',
    })

    await waitFor(() => dispatched.length === 4)

    completions.get(dispatched[3].sessionId)?.resolve({
      status: 'done',
      output: 'Looks good now.\nVERDICT: APPROVED',
    })

    await waitFor(() => {
      const swarm = orchestrator.get(result.swarmId)
      return swarm?.sessions.length === 4 && swarm.sessions.every((s) => s.status === 'done')
    })

    expect(dispatched).toHaveLength(4)
    const swarm = orchestrator.get(result.swarmId)!
    expect(swarm.sessions.map((session) => session.role)).toEqual([
      'implementer',
      'reviewer',
      'implementer',
      'reviewer',
    ])
  })

  it('stops the review loop at maxIterations even if the reviewer keeps rejecting', async () => {
    const dispatched: SwarmDispatchInput[] = []
    const completions = new Map<string, Deferred<{ status: 'done'; output: string }>>()
    const orchestrator = new SwarmOrchestrator({
      getProject: () => ({ id: 'project-1', repoPath: '/repo' }),
      createThread: () => ({ id: 'thread-1' }),
      routeModel: (input) => ({ agentId: input.preferredAgentId, model: 'claude-sonnet-4-6' }),
      dispatchSession: (input) => {
        dispatched.push(input)
        completions.set(input.sessionId, deferred<{ status: 'done'; output: string }>())
        return { sessionId: input.sessionId, threadId: input.threadId, status: 'running' }
      },
      waitForSessionCompletion: (sessionId) => completions.get(sessionId)!.promise,
      worktrees: createFakeWorktrees(),
    })

    const result = await orchestrator.spawn({
      projectId: 'project-1',
      prompt: 'Refactor the parser',
      strategy: 'sequential',
      agents: [
        { role: 'implementer', agentId: 'codex' },
        { role: 'reviewer', agentId: 'claude-code' },
      ],
      maxIterations: 2,
    })

    async function answerRejected(index: number) {
      await waitFor(() => dispatched.length >= index + 1)
      completions.get(dispatched[index].sessionId)?.resolve({
        status: 'done',
        output: index % 2 === 0 ? `attempt ${index}` : 'FEEDBACK: still broken\nVERDICT: REJECTED',
      })
    }

    await answerRejected(0)
    await answerRejected(1)
    await answerRejected(2)
    await answerRejected(3)

    await waitFor(() => {
      const swarm = orchestrator.get(result.swarmId)
      return swarm?.sessions.length === 4
    })

    expect(dispatched).toHaveLength(4)
    expect(dispatched.map((call) => call.role)).toEqual([
      'implementer',
      'reviewer',
      'implementer',
      'reviewer',
    ])
  })

  it('runs reviewer loop when a sequential step has reviewer in its role', async () => {
    const dispatched: SwarmDispatchInput[] = []
    const completions = new Map<string, Deferred<{ status: 'done'; output: string }>>()
    const orchestrator = new SwarmOrchestrator({
      getProject: () => ({ id: 'project-1', repoPath: '/repo' }),
      createThread: () => ({ id: 'thread-1' }),
      routeModel: (input) => ({ agentId: input.preferredAgentId, model: 'claude-sonnet-4-6' }),
      dispatchSession: (input) => {
        dispatched.push(input)
        completions.set(input.sessionId, deferred<{ status: 'done'; output: string }>())
        return { sessionId: input.sessionId, threadId: input.threadId, status: 'running' }
      },
      waitForSessionCompletion: (sessionId) => completions.get(sessionId)!.promise,
      worktrees: createFakeWorktrees(),
    })

    await orchestrator.spawn({
      projectId: 'project-1',
      prompt: 'Build auth module',
      strategy: 'sequential',
      agents: [
        { role: 'planner', agentId: 'claude-code' },
        { role: 'implementer', agentId: 'codex' },
        { role: 'code reviewer', agentId: 'claude-code' },
      ],
    })

    completions.get(dispatched[0].sessionId)?.resolve({ status: 'done', output: 'plan output' })
    await waitFor(() => dispatched.length === 2)

    expect(dispatched[1].prompt).toContain('[Role: implementer]')
    expect(dispatched[1].prompt).toContain('plan output')

    completions.get(dispatched[1].sessionId)?.resolve({ status: 'done', output: 'impl output' })
    await waitFor(() => dispatched.length === 3)

    expect(dispatched[2].prompt).toContain('[Role: code reviewer]')
    expect(dispatched[2].prompt).toContain('Implementation to review')
    expect(dispatched[2].prompt).toContain('impl output')

    completions.get(dispatched[2].sessionId)?.resolve({ status: 'done', output: 'VERDICT: APPROVED' })
  })

  it('cancels every session in a swarm without creating worktrees', async () => {
    const worktrees = createFakeWorktrees()
    const cancelSession = vi.fn()
    const orchestrator = new SwarmOrchestrator({
      getProject: () => ({ id: 'project-1', repoPath: '/repo' }),
      createThread: () => ({ id: 'thread-1' }),
      routeModel: (input) => ({ agentId: input.preferredAgentId, model: 'claude-sonnet-4-6' }),
      dispatchSession: (input) => ({
        sessionId: input.sessionId,
        threadId: input.threadId,
        status: 'running',
      }),
      cancelSession,
      worktrees,
    })

    const result = await orchestrator.spawn(baseConfig())
    await orchestrator.cancel(result.swarmId)

    expect(cancelSession).toHaveBeenCalledTimes(2)
    expect(worktrees.remove).not.toHaveBeenCalled()
    expect(orchestrator.get(result.swarmId)).toBeUndefined()
  })

  it('uses settings as the authoritative swarm agent limit', async () => {
    const orchestrator = new SwarmOrchestrator({
      getProject: () => ({ id: 'project-1', repoPath: '/repo' }),
      createThread: () => ({ id: 'thread-1' }),
      routeModel: (input) => ({ agentId: input.preferredAgentId, model: 'claude-sonnet-4-6' }),
      dispatchSession: (input) => ({ sessionId: input.sessionId, status: 'running' }),
      worktrees: createFakeWorktrees(),
      getSettings: () => ({
        ...DEFAULT_APP_SETTINGS,
        swarms: {
          ...DEFAULT_APP_SETTINGS.swarms,
          maxAgents: 1,
        },
      }),
    })

    await expect(orchestrator.spawn(baseConfig())).rejects.toThrow('Swarm agent limit is 1')
  })
})

function baseConfig(): SwarmConfig {
  return {
    projectId: 'project-1',
    prompt: 'Review the current codebase',
    strategy: 'parallel',
    agents: [
      { role: 'analyzer', agentId: 'claude-code' },
      {
        role: 'reviewer',
        agentId: 'codex',
        modelOverride: 'gpt-5.3-codex',
        promptSuffix: 'Check implementation quality',
      },
    ],
  }
}

function createFakeWorktrees() {
  const sessions = new Map<string, string>()
  let counter = 0

  return {
    create: vi.fn((sessionId: string) => {
      counter += 1
      const worktreePath = `/tmp/worktree-${counter}`
      sessions.set(sessionId, worktreePath)
      return Promise.resolve(worktreePath)
    }),
    remove: vi.fn((sessionId: string) => {
      sessions.delete(sessionId)
      return Promise.resolve()
    }),
    reassignSession: vi.fn((previousSessionId: string, nextSessionId: string) => {
      const worktreePath = sessions.get(previousSessionId)
      if (worktreePath) {
        sessions.delete(previousSessionId)
        sessions.set(nextSessionId, worktreePath)
      }
    }),
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  throw new Error('Timed out waiting for condition')
}
