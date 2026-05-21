import { describe, expect, it } from 'vitest'
import {
  buildPlanExecutionPrompt,
  buildPlanModePrompt,
  PLAN_MODE_HEADER,
} from './planModePrompt'

describe('buildPlanModePrompt', () => {
  it('wraps the task with planning instructions and a no-changes directive', () => {
    const prompt = buildPlanModePrompt('add a settings page')

    expect(prompt).toContain(PLAN_MODE_HEADER)
    expect(prompt).toContain('add a settings page')
    // The planning phase must not touch the repository.
    expect(prompt).toMatch(/do not edit files/i)
  })

  it('trims surrounding whitespace from the task', () => {
    expect(buildPlanModePrompt('  spaced task  ')).toContain('Task:\nspaced task')
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
})
