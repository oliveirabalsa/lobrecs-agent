import { describe, expect, it, vi } from 'vitest'
import type { SwarmConfig } from '../../shared/types'
import { SwarmOrchestrator, type SwarmDispatchInput } from './SwarmOrchestrator'

describe('SwarmOrchestrator', () => {
  it('spawns parallel agents in isolated worktrees', async () => {
    const worktrees = createFakeWorktrees()
    const dispatched: SwarmDispatchInput[] = []
    const orchestrator = new SwarmOrchestrator({
      getProject: async () => ({ id: 'project-1', repoPath: '/repo' }),
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
    expect(result.sessions).toHaveLength(2)
    expect(worktrees.create).toHaveBeenCalledTimes(2)
    expect(dispatched.map((call) => call.repoPath)).toEqual(['/tmp/worktree-1', '/tmp/worktree-2'])
    expect(dispatched[0].prompt).toContain('[Role: analyzer]')
    expect(dispatched[1].prompt).toContain('Check implementation quality')
  })

  it('feeds sequential output into the next agent prompt', async () => {
    const worktrees = createFakeWorktrees()
    const dispatched: SwarmDispatchInput[] = []
    const orchestrator = new SwarmOrchestrator({
      getProject: () => ({ id: 'project-1', repoPath: '/repo' }),
      routeModel: (input) => ({ agentId: input.preferredAgentId, model: 'gpt-5.2-codex' }),
      dispatchSession: (input) => {
        dispatched.push(input)
        return { sessionId: input.sessionId, status: 'running', output: `output from ${input.role}` }
      },
      worktrees,
    })

    await orchestrator.spawn({
      ...baseConfig(),
      strategy: 'sequential',
    })

    expect(dispatched).toHaveLength(2)
    expect(dispatched[0].prompt).not.toContain('Context from previous step')
    expect(dispatched[1].prompt).toContain('Context from previous step')
    expect(dispatched[1].prompt).toContain('output from analyzer')
  })

  it('cancels every session in a swarm and removes its worktrees', async () => {
    const worktrees = createFakeWorktrees()
    const cancelSession = vi.fn()
    const orchestrator = new SwarmOrchestrator({
      getProject: () => ({ id: 'project-1', repoPath: '/repo' }),
      routeModel: (input) => ({ agentId: input.preferredAgentId, model: 'claude-sonnet-4-6' }),
      dispatchSession: (input) => ({ sessionId: input.sessionId, status: 'running' }),
      cancelSession,
      worktrees,
    })

    const result = await orchestrator.spawn(baseConfig())
    await orchestrator.cancel(result.swarmId)

    expect(cancelSession).toHaveBeenCalledTimes(2)
    expect(worktrees.remove).toHaveBeenCalledTimes(2)
    expect(orchestrator.get(result.swarmId)).toBeUndefined()
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
        modelOverride: 'gpt-5.2-codex',
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
