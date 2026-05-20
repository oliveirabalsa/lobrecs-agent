import { describe, expect, it } from 'vitest'
import { parseSwarmPlan, parseSwarmRolePrompt, swarmRoleKind } from './swarmMessage'

describe('parseSwarmPlan', () => {
  it('parses a bare JSON manager plan', () => {
    const text = JSON.stringify({
      strategy: 'sequential',
      agents: [
        { role: 'planner', agentId: 'claude-code', promptSuffix: 'Plan it' },
        { role: 'implementer', agentId: 'codex' },
      ],
    })

    const plan = parseSwarmPlan(text)

    expect(plan).not.toBeNull()
    expect(plan?.strategy).toBe('sequential')
    expect(plan?.agents).toEqual([
      {
        role: 'planner',
        agentId: 'claude-code',
        agentLabel: 'Claude Code',
        modelOverride: undefined,
        promptSuffix: 'Plan it',
      },
      {
        role: 'implementer',
        agentId: 'codex',
        agentLabel: 'OpenAI Codex',
        modelOverride: undefined,
        promptSuffix: undefined,
      },
    ])
  })

  it('unwraps a fenced ```json block', () => {
    const text = '```json\n{"strategy":"parallel","agents":[{"role":"a","agentId":"opencode"}]}\n```'
    expect(parseSwarmPlan(text)?.strategy).toBe('parallel')
  })

  it('falls back to the raw agent id for unknown agents', () => {
    const text = '{"strategy":"parallel","agents":[{"role":"a","agentId":"future-cli"}]}'
    expect(parseSwarmPlan(text)?.agents[0].agentLabel).toBe('future-cli')
  })

  it('rejects non-plan JSON and prose', () => {
    expect(parseSwarmPlan('Here is my answer.')).toBeNull()
    expect(parseSwarmPlan('{"foo":"bar"}')).toBeNull()
    expect(parseSwarmPlan('{"strategy":"sequential","agents":[]}')).toBeNull()
    expect(parseSwarmPlan('{"strategy":"sequential","agents":[{"role":"a"}]}')).toBeNull()
  })
})

describe('parseSwarmRolePrompt', () => {
  it('splits the role header from the body', () => {
    const result = parseSwarmRolePrompt('[Role: reviewer]\nReview the implementation')
    expect(result).toEqual({ role: 'reviewer', body: 'Review the implementation' })
  })

  it('ignores prompts without a role header', () => {
    expect(parseSwarmRolePrompt('Just a normal prompt')).toBeNull()
    expect(parseSwarmRolePrompt('[Role: ]\nempty')).toBeNull()
  })
})

describe('swarmRoleKind', () => {
  it('classifies roles by keyword', () => {
    expect(swarmRoleKind('planner')).toBe('planner')
    expect(swarmRoleKind('Lead Implementer')).toBe('builder')
    expect(swarmRoleKind('code reviewer')).toBe('reviewer')
    expect(swarmRoleKind('security analyzer')).toBe('security')
    expect(swarmRoleKind('vibes')).toBe('generic')
  })
})
