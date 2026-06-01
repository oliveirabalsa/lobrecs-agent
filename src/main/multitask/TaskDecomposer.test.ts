import { describe, expect, it, vi } from 'vitest'
import { enforceMaxTasks, TaskDecomposer, type TaskDecomposerDependencies } from './TaskDecomposer'

function createMockDependencies(
  overrides: Partial<TaskDecomposerDependencies> = {},
): TaskDecomposerDependencies {
  return {
    dispatchAndWait: vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          title: 'Build API endpoint',
          description: 'Create the REST endpoint for user registration',
          complexity: 'high',
        },
        {
          title: 'Add validation',
          description: 'Add input validation for the registration form',
          complexity: 'low',
          dependsOn: ['Build API endpoint'],
        },
      ]),
    ),
    routeModel: vi.fn().mockResolvedValue({
      agentId: 'opencode',
      model: 'minimax/MiniMax-M2',
      tier: 'lightweight',
    }),
    estimateCost: vi.fn().mockReturnValue(0.02),
    ...overrides,
  }
}

describe('TaskDecomposer', () => {
  it('decomposes a prompt into a multitask plan', async () => {
    const deps = createMockDependencies()
    const decomposer = new TaskDecomposer(deps)

    const plan = await decomposer.decompose({
      projectId: 'test-project',
      prompt: 'Build a user registration feature with validation',
    })

    expect(plan.planId).toBeTruthy()
    expect(plan.originalPrompt).toBe(
      'Build a user registration feature with validation',
    )
    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks[0].title).toBe('Build API endpoint')
    expect(plan.tasks[1].title).toBe('Add validation')
    expect(plan.decomposedBy.agentId).toBe('opencode')
  })

  it('assigns optimal model per task via routeModel', async () => {
    const routeModel = vi
      .fn()
      .mockResolvedValueOnce({
        agentId: 'opencode',
        model: 'minimax/MiniMax-M2',
        tier: 'lightweight',
      })
      .mockResolvedValueOnce({
        agentId: 'codex',
        model: 'gpt-5.4',
        tier: 'advanced',
      })
      .mockResolvedValueOnce({
        agentId: 'opencode',
        model: 'minimax/MiniMax-M2',
        tier: 'lightweight',
      })
    const deps = createMockDependencies({ routeModel })
    const decomposer = new TaskDecomposer(deps)

    const plan = await decomposer.decompose({
      projectId: 'test-project',
      prompt: 'Complex task',
    })

    expect(routeModel).toHaveBeenCalledTimes(3)
    expect(plan.tasks[0].agentId).toBe('codex')
    expect(plan.tasks[0].model).toBe('gpt-5.4')
  })

  it('routes multitask workers with AUTO mode, complexity minimums, and strong agent preference', async () => {
    const routeModel = vi
      .fn()
      .mockImplementation((input: Parameters<TaskDecomposerDependencies['routeModel']>[0]) => {
        const selectedAgent = input.agentPreference?.[0] ?? input.preferredAgentId
        const tier = input.minimumTier ?? 'balanced'
        return Promise.resolve({
          agentId: selectedAgent,
          model: `${selectedAgent}:${tier}`,
          tier,
        })
      })
    const deps = createMockDependencies({ routeModel })
    const decomposer = new TaskDecomposer(deps)

    const plan = await decomposer.decompose({
      projectId: 'test-project',
      prompt: 'Build a user registration feature with validation',
    })

    expect(routeModel).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        preferredAgentId: 'codex',
        autoAgentSelection: true,
        minimumTier: 'advanced',
        agentPreference: ['codex', 'claude-code', 'antigravity', 'cursor', 'opencode'],
      }),
    )
    expect(routeModel).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        preferredAgentId: 'codex',
        autoAgentSelection: true,
        minimumTier: 'advanced',
        agentPreference: ['codex', 'claude-code', 'antigravity', 'cursor', 'opencode'],
        prompt: expect.stringContaining('Task complexity: high'),
      }),
    )
    expect(routeModel).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        preferredAgentId: 'claude-code',
        autoAgentSelection: true,
        minimumTier: 'lightweight',
        agentPreference: ['claude-code', 'antigravity', 'cursor', 'codex', 'opencode'],
        prompt: expect.stringContaining('Task complexity: low'),
      }),
    )
    expect(plan.tasks.map((task) => task.agentId)).toEqual(['codex', 'claude-code'])
    expect(plan.tasks.map((task) => task.model)).toEqual([
      'codex:advanced',
      'claude-code:lightweight',
    ])
  })

  it('resolves dependsOn titles to task IDs', async () => {
    const deps = createMockDependencies()
    const decomposer = new TaskDecomposer(deps)

    const plan = await decomposer.decompose({
      projectId: 'test-project',
      prompt: 'Test dependencies',
    })

    expect(plan.tasks[1].dependsOn).toBeDefined()
    expect(plan.tasks[1].dependsOn).toHaveLength(1)
    expect(plan.tasks[1].dependsOn![0]).toBe(plan.tasks[0].id)
  })

  it('calculates total estimated cost', async () => {
    const deps = createMockDependencies({
      estimateCost: vi.fn().mockReturnValue(0.05),
    })
    const decomposer = new TaskDecomposer(deps)

    const plan = await decomposer.decompose({
      projectId: 'test-project',
      prompt: 'Cost test',
    })

    expect(plan.totalEstimatedCostUsd).toBe(0.1)
  })

  it('passes parent thread metadata to the decomposer worker', async () => {
    const dispatchAndWait = vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          title: 'Inspect renderer',
          description: 'Find the owning renderer files',
          complexity: 'medium',
        },
      ]),
    )
    const deps = createMockDependencies({ dispatchAndWait })
    const decomposer = new TaskDecomposer(deps)

    await decomposer.decompose(
      {
        projectId: 'test-project',
        prompt: 'Fix multitask rendering',
      },
      {
        threadId: 'thread-1',
        parentSessionId: 'session-1',
        maxTasks: 3,
      },
    )

    expect(dispatchAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'test-project',
        threadId: 'thread-1',
        parentSessionId: 'session-1',
        prompt: expect.stringContaining('Return at most 3 subtasks'),
      }),
    )
  })

  it('caps generated tasks to the configured swarm agent limit', async () => {
    const dispatchAndWait = vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          title: 'Task one',
          description: 'Do the first task',
          complexity: 'low',
        },
        {
          title: 'Task two',
          description: 'Do the second task',
          complexity: 'medium',
        },
        {
          title: 'Task three',
          description: 'Do the third task',
          complexity: 'critical',
          dependsOn: ['Task one'],
        },
      ]),
    )
    const deps = createMockDependencies({ dispatchAndWait })
    const decomposer = new TaskDecomposer(deps)

    const plan = await decomposer.decompose(
      {
        projectId: 'test-project',
        prompt: 'Too many tasks',
      },
      { maxTasks: 2 },
    )

    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks[1].description).toContain('Task three: Do the third task')
    expect(plan.tasks[1].tier).toBe('frontier')
    expect(plan.tasks[1].dependsOn).toEqual([plan.tasks[0].id])
  })

  it('upgrades tier when complexity hint exceeds router tier', async () => {
    const routeModel = vi
      .fn()
      .mockResolvedValueOnce({
        agentId: 'opencode',
        model: 'minimax/MiniMax-M2',
        tier: 'lightweight',
      })
      .mockResolvedValue({
        agentId: 'opencode',
        model: 'minimax/MiniMax-M2',
        tier: 'lightweight',
      })

    const dispatchAndWait = vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          title: 'Security audit',
          description: 'Audit the entire auth system for vulnerabilities',
          complexity: 'critical',
        },
      ]),
    )

    const deps = createMockDependencies({ routeModel, dispatchAndWait })
    const decomposer = new TaskDecomposer(deps)

    const plan = await decomposer.decompose({
      projectId: 'test-project',
      prompt: 'Audit security',
    })

    expect(plan.tasks[0].tier).toBe('frontier')
  })
})

describe('enforceMaxTasks', () => {
  it('consolidates overflow tasks into the last allowed task', () => {
    const tasks = enforceMaxTasks(
      [
        { title: 'A', description: 'Do A', complexity: 'low' },
        { title: 'B', description: 'Do B', complexity: 'medium' },
        { title: 'C', description: 'Do C', complexity: 'high', dependsOn: ['A'] },
      ],
      2,
    )

    expect(tasks).toHaveLength(2)
    expect(tasks[1]).toMatchObject({
      title: 'B',
      complexity: 'high',
      dependsOn: ['A'],
    })
    expect(tasks[1].description).toContain('C: Do C')
  })
})
