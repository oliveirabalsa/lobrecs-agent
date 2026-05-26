import { describe, expect, it } from 'vitest'
import type { AgentEvent, Session } from '../../../../shared/types'
import { buildSwarmGraph, roleFromPrompt } from './swarmGraph'

const baseSession = {
  projectId: 'project-1',
  threadId: 'thread-1',
  agentId: 'codex',
  model: 'gpt-5.3-codex',
  tokensIn: 0,
  tokensOut: 0,
  costUsd: 0,
} satisfies Partial<Session>

describe('roleFromPrompt', () => {
  it('extracts swarm role headers', () => {
    expect(roleFromPrompt('[Role: reviewer]\nReview the implementation')).toBe('reviewer')
  })

  it('ignores prompts without role headers', () => {
    expect(roleFromPrompt('plain prompt')).toBeNull()
  })
})

describe('buildSwarmGraph', () => {
  it('builds ordered nodes and handoff edges from thread sessions', () => {
    const sessions: Session[] = [
      {
        ...baseSession,
        id: 'session-2',
        prompt: '[Role: reviewer]\nReview prior work',
        status: 'running',
        createdAt: 2_000,
      } as Session,
      {
        ...baseSession,
        id: 'session-1',
        prompt: '[Role: planner]\nPlan the change',
        status: 'done',
        createdAt: 1_000,
        completedAt: 1_500,
      } as Session,
    ]
    const events = new Map<string, AgentEvent[]>([
      [
        'session-1',
        [
          {
            type: 'activity',
            sessionId: 'session-1',
            timestamp: 1_400,
            payload: {
              kind: 'message',
              role: 'assistant',
              text: 'Use a small vertical slice.',
            },
          },
        ],
      ],
    ])

    const graph = buildSwarmGraph(sessions, events)

    expect(graph.nodes.map((node) => node.role)).toEqual(['planner', 'reviewer'])
    expect(graph.nodes[0]).toMatchObject({
      id: 'session-1',
      status: 'done',
      inputPreview: 'Plan the change',
      outputPreview: 'Use a small vertical slice.',
    })
    expect(graph.edges).toEqual([
      {
        id: 'session-1->session-2',
        from: 'session-1',
        to: 'session-2',
        label: 'review handoff',
        preview: 'Review prior work',
      },
    ])
  })

  it('uses the active status override for live renderer state', () => {
    const sessions: Session[] = [
      {
        ...baseSession,
        id: 'session-1',
        prompt: '[Role: implementer]\nBuild it',
        status: 'running',
        createdAt: 1_000,
      } as Session,
    ]

    const graph = buildSwarmGraph(sessions, new Map(), {
      sessionId: 'session-1',
      status: 'awaiting-approval',
    })

    expect(graph.nodes[0]?.status).toBe('awaiting-approval')
    expect(graph.activeCount).toBe(1)
  })

  it('summarizes todo-list activity output without breaking graph rendering', () => {
    const sessions: Session[] = [
      {
        ...baseSession,
        id: 'session-1',
        prompt: '[Role: implementer]\nBuild it',
        status: 'running',
        createdAt: 1_000,
      } as Session,
    ]
    const events = new Map<string, AgentEvent[]>([
      [
        'session-1',
        [
          {
            type: 'activity',
            sessionId: 'session-1',
            timestamp: 1_200,
            payload: {
              kind: 'todo-list',
              items: [
                { id: 'todo-1', text: 'Ship the UI', completed: true },
                { id: 'todo-2', text: 'Add tests', completed: false },
              ],
            },
          },
        ],
      ],
    ])

    const graph = buildSwarmGraph(sessions, events)

    expect(graph.nodes[0]).toMatchObject({
      outputPreview: '1/2 to-dos complete',
      messageCount: 1,
    })
  })

  it('summarizes multitask-plan activity as an approval-style handoff', () => {
    const sessions: Session[] = [
      {
        ...baseSession,
        id: 'session-1',
        prompt: '[Role: planner]\nBreak down the work',
        status: 'awaiting-approval',
        createdAt: 1_000,
      } as Session,
    ]
    const events = new Map<string, AgentEvent[]>([
      [
        'session-1',
        [
          {
            type: 'activity',
            sessionId: 'session-1',
            timestamp: 1_200,
            payload: {
              kind: 'multitask-plan',
              planId: 'plan-1',
              tasks: [
                {
                  id: 'task-1',
                  title: 'Update UI',
                  prompt: 'Refresh the composer controls',
                  recommendedAgentId: 'codex',
                  recommendedModel: 'gpt-5.3-codex',
                  complexity: 'medium',
                  reasoning: 'UI work',
                  estimatedCostUsd: 0.25,
                },
                {
                  id: 'task-2',
                  title: 'Add orchestration tests',
                  prompt: 'Cover the spawn flow',
                  recommendedAgentId: 'claude-code',
                  recommendedModel: 'claude-sonnet-4.5',
                  complexity: 'medium',
                  reasoning: 'Test coverage',
                  estimatedCostUsd: 0.2,
                },
              ],
              totalEstimatedCostUsd: 0.45,
              decomposedBy: { agentId: 'codex', model: 'gpt-5.3-mini' },
              originalPrompt: 'Implement multitask mode',
            },
          },
        ],
      ],
    ])

    const graph = buildSwarmGraph(sessions, events)

    expect(graph.nodes[0]).toMatchObject({
      outputPreview: '2 multitask items ready',
      approvalCount: 1,
    })
  })
})
