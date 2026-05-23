import { describe, expect, it } from 'vitest'
import type { AgentActivity } from '../../../../../shared/types'
import {
  latestPlanReviewId,
  shouldContinuePlanModeAfterQuestionAnswer,
  shouldResetPlanModeAfterDispatch,
} from './planMode'

describe('shouldResetPlanModeAfterDispatch', () => {
  it('resets plan mode after a plan-mode dispatch', () => {
    expect(shouldResetPlanModeAfterDispatch(true)).toBe(true)
  })

  it('keeps plan mode unchanged for non-plan dispatches', () => {
    expect(shouldResetPlanModeAfterDispatch(false)).toBe(false)
  })
})

describe('shouldContinuePlanModeAfterQuestionAnswer', () => {
  it('continues plan mode when the interrupted session was in plan mode', () => {
    expect(shouldContinuePlanModeAfterQuestionAnswer(true)).toBe(true)
  })

  it('does not turn normal question answers into plan-mode dispatches', () => {
    expect(shouldContinuePlanModeAfterQuestionAnswer(false)).toBe(false)
    expect(shouldContinuePlanModeAfterQuestionAnswer(undefined)).toBe(false)
    expect(shouldContinuePlanModeAfterQuestionAnswer(null)).toBe(false)
  })
})

describe('latestPlanReviewId', () => {
  it('returns null when no plan review marker exists', () => {
    const activities: AgentActivity[] = [
      { kind: 'step', title: 'Running checks', status: 'running' },
      { kind: 'completion', status: 'done', summary: 'Done' },
    ]
    expect(latestPlanReviewId(activities)).toBeNull()
  })

  it('returns the latest plan-review id', () => {
    const activities: AgentActivity[] = [
      { kind: 'plan-review', reviewId: 'review-1', agentId: 'claude-code', model: 'claude-sonnet-4-6' },
      { kind: 'step', title: 'Other item', status: 'done' },
      { kind: 'plan-review', reviewId: 'review-2', agentId: 'claude-code', model: 'claude-sonnet-4-6' },
    ]
    expect(latestPlanReviewId(activities)).toBe('review-2')
  })
})
