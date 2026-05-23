import { describe, expect, it } from 'vitest'
import {
  buildPlanExecutionPrompt,
  buildPlanModeContext,
  PLAN_MODE_HEADER,
} from './planModePrompt'

describe('buildPlanModeContext', () => {
  it('adds planning instructions and a no-changes directive', () => {
    const context = buildPlanModeContext('AGENTS.md')

    expect(context).toContain('AGENTS.md')
    expect(context).toContain(PLAN_MODE_HEADER)
    // The planning phase must not touch the repository.
    expect(context).toMatch(/do not edit files/i)
  })

  it('keeps plan mode from becoming a plan-to-plan task', () => {
    const context = buildPlanModeContext(null)

    expect(context).toMatch(/implementation plan itself/i)
    expect(context).toMatch(/actual work request/i)
    expect(context).toMatch(/even if the UI says the user asked for a plan/i)
    expect(context).toMatch(/read-only/i)
    expect(context).toMatch(/do not run commands/i)
    expect(context).toMatch(/do not create a plan for drafting another plan/i)
    expect(context).toMatch(/planning the planning process/i)
    expect(context).toMatch(/this response is the plan/i)
  })

  it('routes clarifying questions through the AskUserQuestion tool', () => {
    const context = buildPlanModeContext(null)

    // Agent must be told to use the structured question tool, not inline markdown.
    expect(context).toContain('AskUserQuestion')
    expect(context).toMatch(/do not inline questions/i)
  })
})

describe('buildPlanExecutionPrompt', () => {
  it('releases the agent to execute without re-issuing planning instructions', () => {
    const prompt = buildPlanExecutionPrompt()

    expect(prompt).toContain(PLAN_MODE_HEADER)
    expect(prompt).toMatch(/approved/i)
    // The execution phase must NOT carry the planning phase's no-changes rule.
    expect(prompt).not.toMatch(/do not edit files/i)
  })

  it('includes edited plan text and suggestions when provided at approval time', () => {
    const prompt = buildPlanExecutionPrompt({
      editedPlanText: '1. Update composer state\n2. Add regression tests',
      suggestionText: 'Prefer codex for final implementation and keep context intact.',
    })

    expect(prompt).toContain('Use this edited approved plan as the source of truth:')
    expect(prompt).toContain('1. Update composer state')
    expect(prompt).toContain('Additional user suggestions to apply while executing:')
    expect(prompt).toContain('Prefer codex for final implementation')
  })
})
