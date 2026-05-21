import { describe, expect, it } from 'vitest'
import type { AgentActivity } from '../../../../../shared/types'
import {
  latestPlanReviewId,
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
      { kind: 'plan-review', reviewId: 'review-1' },
      { kind: 'step', title: 'Other item', status: 'done' },
      { kind: 'plan-review', reviewId: 'review-2' },
    ]
    expect(latestPlanReviewId(activities)).toBe('review-2')
  })
})
