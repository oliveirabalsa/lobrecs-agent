import { describe, expect, it } from 'vitest'
import {
  buildPlanReviewDecisionPayload,
  findPlanReviewManualOption,
  normalizePlanReviewText,
  resolvePlanReviewOutcome,
  selectPlanReviewModel,
  toPlanReviewMarkdownDocument,
} from './PlanReviewCard'
import type { ModelGroup, ModelSelection } from '../Composer/types'

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

describe('normalizePlanReviewText', () => {
  it('trims non-empty text and drops empty values', () => {
    expect(normalizePlanReviewText('  do the work  ')).toBe('do the work')
    expect(normalizePlanReviewText('   ')).toBeUndefined()
    expect(normalizePlanReviewText(undefined)).toBeUndefined()
  })
})

describe('buildPlanReviewDecisionPayload', () => {
  it('keeps reject payloads minimal', () => {
    expect(
      buildPlanReviewDecisionPayload({
        reviewId: 'review-1',
        sessionId: 'session-1',
        choice: 'reject',
        editedPlanText: 'ignored',
        suggestionText: 'ignored',
      }),
    ).toEqual({
      reviewId: 'review-1',
      sessionId: 'session-1',
      decision: 'reject',
    })
  })

  it('includes edited plan text only when it differs from the original plan', () => {
    const payload = buildPlanReviewDecisionPayload({
      reviewId: 'review-1',
      sessionId: 'session-1',
      choice: 'approve',
      originalPlanText: '1. Keep this',
      editedPlanText: '1. Keep this\n2. Add tests',
      suggestionText: 'Prefer focused test runs',
    })

    expect(payload).toEqual({
      reviewId: 'review-1',
      sessionId: 'session-1',
      decision: 'approve',
      editedPlanText: '1. Keep this\n2. Add tests',
      suggestionText: 'Prefer focused test runs',
    })
  })

  it('omits unchanged plan text and blank suggestions', () => {
    const payload = buildPlanReviewDecisionPayload({
      reviewId: 'review-1',
      sessionId: 'session-1',
      choice: 'approve',
      originalPlanText: '1. Keep this',
      editedPlanText: ' 1. Keep this ',
      suggestionText: '   ',
    })

    expect(payload).toEqual({
      reviewId: 'review-1',
      sessionId: 'session-1',
      decision: 'approve',
    })
  })

  it('includes modelOverride when it differs from the planning model', () => {
    const payload = buildPlanReviewDecisionPayload({
      reviewId: 'review-1',
      sessionId: 'session-1',
      choice: 'approve',
      planningAgentId: 'claude-code',
      planningModel: 'claude-sonnet-4-6',
      modelOverride: 'claude-opus-4-7',
    })

    expect(payload).toEqual({
      reviewId: 'review-1',
      sessionId: 'session-1',
      decision: 'approve',
      modelOverride: 'claude-opus-4-7',
    })
  })

  it('includes agent and model when the implementer differs from the planner', () => {
    const payload = buildPlanReviewDecisionPayload({
      reviewId: 'review-1',
      sessionId: 'session-1',
      choice: 'approve',
      planningAgentId: 'claude-code',
      planningModel: 'claude-sonnet-4-6',
      agentOverride: 'codex',
      modelOverride: 'gpt-5.3-codex',
    })

    expect(payload).toEqual({
      reviewId: 'review-1',
      sessionId: 'session-1',
      decision: 'approve',
      agentId: 'codex',
      modelOverride: 'gpt-5.3-codex',
    })
  })

  it('omits modelOverride when it matches the planning model', () => {
    const payload = buildPlanReviewDecisionPayload({
      reviewId: 'review-1',
      sessionId: 'session-1',
      choice: 'approve',
      planningAgentId: 'claude-code',
      planningModel: 'claude-sonnet-4-6',
      agentOverride: 'claude-code',
      modelOverride: 'claude-sonnet-4-6',
    })

    expect(payload).toEqual({
      reviewId: 'review-1',
      sessionId: 'session-1',
      decision: 'approve',
    })
  })

  it('omits modelOverride from reject payloads', () => {
    expect(
      buildPlanReviewDecisionPayload({
        reviewId: 'review-1',
        sessionId: 'session-1',
        choice: 'reject',
        agentOverride: 'codex',
        modelOverride: 'claude-opus-4-7',
      }),
    ).toEqual({
      reviewId: 'review-1',
      sessionId: 'session-1',
      decision: 'reject',
    })
  })
})

describe('selectPlanReviewModel', () => {
  const groups: ModelGroup[] = [
    {
      agentId: 'codex',
      label: 'OpenAI Codex',
      options: [
        {
          key: 'codex:gpt-5.3-codex',
          agentId: 'codex',
          agentName: 'OpenAI Codex',
          modelId: 'gpt-5.3-codex',
          label: 'GPT-5.3 Codex',
          tier: 'balanced',
        },
        {
          key: 'codex:gpt-5.5',
          agentId: 'codex',
          agentName: 'OpenAI Codex',
          modelId: 'gpt-5.5',
          label: 'GPT-5.5',
          tier: 'frontier',
        },
      ],
    },
    {
      agentId: 'antigravity',
      label: 'Antigravity CLI',
      options: [
        {
          key: 'antigravity:gemini-3.0-pro',
          agentId: 'antigravity',
          agentName: 'Antigravity CLI',
          modelId: 'gemini-3.0-pro',
          label: 'Gemini 3.0 Pro',
          tier: 'advanced',
        },
      ],
    },
  ]

  it('prefers the exact planning model when it exists in the provider groups', () => {
    expect(selectPlanReviewModel(groups, 'codex', 'gpt-5.5')).toEqual({
      kind: 'manual',
      agentId: 'codex',
      modelId: 'gpt-5.5',
    })
  })

  it('falls back to another model from the planning provider before other providers', () => {
    expect(selectPlanReviewModel(groups, 'codex', 'gpt-6')).toEqual({
      kind: 'manual',
      agentId: 'codex',
      modelId: 'gpt-5.3-codex',
    })
  })

  it('keeps an unknown planning model selectable until live catalogs load', () => {
    expect(selectPlanReviewModel([], 'codex', 'gpt-5.5')).toEqual({
      kind: 'manual',
      agentId: 'codex',
      modelId: 'gpt-5.5',
    })
  })
})

describe('findPlanReviewManualOption', () => {
  it('returns a display fallback for selected models missing from catalogs', () => {
    const selection: ModelSelection = {
      kind: 'manual',
      agentId: 'codex',
      modelId: 'gpt-5.5',
    }

    expect(findPlanReviewManualOption([], selection)).toMatchObject({
      agentId: 'codex',
      modelId: 'gpt-5.5',
      label: 'GPT-5.5',
    })
  })
})
