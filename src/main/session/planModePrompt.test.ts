import { describe, expect, it } from 'vitest'
import {
  buildPlanExecutionPrompt,
  buildPlanModeContext,
  PLAN_MODE_HEADER,
} from './planModePrompt'

describe('buildPlanModeContext', () => {
  it('adds planning instructions and a no-mutations directive', () => {
    const context = buildPlanModeContext('AGENTS.md')

    expect(context).toContain('AGENTS.md')
    expect(context).toContain(PLAN_MODE_HEADER)
    // The planning phase must not mutate the repository.
    expect(context).toMatch(/do not edit files/i)
    expect(context).toMatch(/do not .*make any repository changes/i)
  })

  it('keeps plan mode from becoming a plan-to-plan task', () => {
    const context = buildPlanModeContext(null)

    expect(context).toMatch(/implementation plan itself/i)
    expect(context).toMatch(/without\s+creating\s+another\s+plan\s+first/i)
    expect(context).toMatch(/actual work request/i)
    expect(context).toMatch(/even if the UI says the user asked for a plan/i)
    expect(context).toMatch(/read-only/i)
    expect(context).toMatch(/run targeted\s+read-only diagnostic commands/i)
    expect(context).not.toMatch(/do not run commands/i)
    expect(context).toMatch(/do not create a plan for drafting another plan/i)
    expect(context).toMatch(/planning the planning process/i)
    expect(context).toMatch(/do not include "wait for approval"/i)
    expect(context).toMatch(/app handles approval after this response/i)
    expect(context).toMatch(/this response is the plan/i)
  })

  it('requires live repository investigation instead of only app-provided context', () => {
    const context = buildPlanModeContext(null)

    expect(context).toMatch(/starting evidence, not a substitute for live investigation/i)
    expect(context).toMatch(/actively inspect the repository structure/i)
    expect(context).toMatch(/search\s+for owning files and APIs/i)
    expect(context).toMatch(/read the relevant files/i)
    expect(context).toMatch(/rg --files/i)
    expect(context).toMatch(/repository symbol map/i)
    expect(context).toMatch(/current file structure/i)
    expect(context).toMatch(/do not invent\s+filenames/i)
    expect(context).toMatch(/implementation phase must inspect next/i)
  })

  it('forbids mutating commands during planning while allowing read-only discovery', () => {
    const context = buildPlanModeContext(null)

    expect(context).toMatch(/read-only and investigative/i)
    expect(context).toMatch(/do not edit files/i)
    expect(context).toMatch(/write files/i)
    expect(context).toMatch(/run formatters/i)
    expect(context).toMatch(/install dependencies/i)
    expect(context).toMatch(/change git state/i)
    expect(context).toMatch(/mutating commands/i)
  })

  it('requires a detailed implementable plan shape', () => {
    const context = buildPlanModeContext(null)

    expect(context).toMatch(/goal and expected behavior change/i)
    expect(context).toMatch(/current-state diagnosis/i)
    expect(context).toMatch(/file-by-file implementation steps/i)
    expect(context).toMatch(/focused tests and verification commands/i)
    expect(context).toMatch(/risks, edge cases/i)
    expect(context).toMatch(/keep every step actionable/i)
    expect(context).toMatch(/do not make the plan a generic discovery plan/i)
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
