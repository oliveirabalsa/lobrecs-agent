import { describe, expect, it } from 'vitest'
import {
  resolvePlanReviewOutcome,
  toPlanReviewMarkdownDocument,
} from './PlanReviewCard'

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

describe('toPlanReviewMarkdownDocument', () => {
  it('builds a markdown preview document from the plan text', () => {
    expect(
      toPlanReviewMarkdownDocument('## Steps\n\n1. Update composer state'),
    ).toEqual({
      title: 'Plan review.md',
      content: '## Steps\n\n1. Update composer state',
      sourceLabel: 'Plan review',
      suggestedFileName: 'plan-review.md',
    })
  })

  it('falls back when plan text is blank', () => {
    expect(toPlanReviewMarkdownDocument('   ').content).toBe(
      '_No plan text was captured for this review._',
    )
  })
})
