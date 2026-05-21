import { describe, expect, it } from 'vitest'
import { resolvePlanReviewOutcome } from './PlanReviewCard'

describe('resolvePlanReviewOutcome', () => {
  it('reports an approval that dispatched an execution session as approved', () => {
    expect(
      resolvePlanReviewOutcome('approve', { sessionId: 's1', threadId: 't1' }),
    ).toBe('approved')
  })

  it('reports an approval with no execution session as stale', () => {
    // Main resolves with `null` when the review is already resolved or its
    // planning session is gone — the card must not claim execution has begun.
    expect(resolvePlanReviewOutcome('approve', null)).toBe('stale')
  })

  it('reports a rejection as rejected (its result is null by contract)', () => {
    expect(resolvePlanReviewOutcome('reject', null)).toBe('rejected')
  })
})
