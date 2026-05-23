import { describe, expect, it } from 'vitest'
import { parseManagerPlan } from './managerPrompt'

const INPUT = {
  supportedAgentIds: ['claude-code', 'codex', 'opencode', 'antigravity'] as const,
  maxAgents: 5,
}

function planJson(strategy: 'sequential' | 'parallel', agents: object[]): string {
  return JSON.stringify({ strategy, agents })
}

describe('parseManagerPlan — requireApprovalAfter gating', () => {
  it('keeps the flag when a sequential planner is followed by an implementer', () => {
    const plan = parseManagerPlan(
      planJson('sequential', [
        {
          role: 'planner',
          agentId: 'claude-code',
          promptSuffix: 'Draft the plan.',
          requireApprovalAfter: true,
        },
        {
          role: 'implementer',
          agentId: 'codex',
          promptSuffix: 'Implement the approved plan.',
        },
      ]),
      INPUT,
    )

    expect(plan.agents[0].requireApprovalAfter).toBe(true)
    expect(plan.agents[1].requireApprovalAfter).toBeUndefined()
  })

  it('drops the flag when the next role is not an implementer', () => {
    const plan = parseManagerPlan(
      planJson('sequential', [
        {
          role: 'planner',
          agentId: 'claude-code',
          promptSuffix: 'Draft the plan.',
          requireApprovalAfter: true,
        },
        {
          role: 'reviewer',
          agentId: 'codex',
          promptSuffix: 'Review the plan.',
        },
      ]),
      INPUT,
    )

    expect(plan.agents[0].requireApprovalAfter).toBeUndefined()
  })

  it('drops the flag on the last agent (no next step to gate)', () => {
    const plan = parseManagerPlan(
      planJson('sequential', [
        {
          role: 'planner',
          agentId: 'claude-code',
          promptSuffix: 'Plan only.',
          requireApprovalAfter: true,
        },
      ]),
      INPUT,
    )

    expect(plan.agents[0].requireApprovalAfter).toBeUndefined()
  })

  it('drops the flag in parallel strategies (no meaningful next step)', () => {
    const plan = parseManagerPlan(
      planJson('parallel', [
        {
          role: 'planner',
          agentId: 'claude-code',
          promptSuffix: 'Plan.',
          requireApprovalAfter: true,
        },
        {
          role: 'implementer',
          agentId: 'codex',
          promptSuffix: 'Implement.',
        },
      ]),
      INPUT,
    )

    expect(plan.agents[0].requireApprovalAfter).toBeUndefined()
  })

  it('drops the flag when the current role is not a planner', () => {
    const plan = parseManagerPlan(
      planJson('sequential', [
        {
          role: 'implementer',
          agentId: 'claude-code',
          promptSuffix: 'Implement first pass.',
          requireApprovalAfter: true,
        },
        {
          role: 'implementer',
          agentId: 'codex',
          promptSuffix: 'Implement second pass.',
        },
      ]),
      INPUT,
    )

    expect(plan.agents[0].requireApprovalAfter).toBeUndefined()
  })
})
