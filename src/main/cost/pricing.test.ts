import { describe, expect, it } from 'vitest'
import { MODEL_PRICING, estimateCost, estimateFromPrompt } from './pricing'
import { MODEL_MAP } from '../../shared/types'

describe('pricing', () => {
  it('has pricing for every model in MODEL_MAP', () => {
    const models = new Set(Object.values(MODEL_MAP).flatMap((tiers) => Object.values(tiers)))

    for (const model of models) {
      expect(MODEL_PRICING[model]).toBeDefined()
    }
  })

  it('estimates input and output token costs', () => {
    const cost = estimateCost('gpt-5.2-codex', 1_000, 2_000)

    expect(cost).toBeCloseTo(0.0055, 8)
  })

  it('returns zero for unknown models', () => {
    expect(estimateCost('unknown-model', 1_000, 1_000)).toBe(0)
  })

  it('normalizes invalid token counts to zero', () => {
    expect(estimateCost('minimax', -1, Number.NaN)).toBe(0)
  })

  it('estimates prompt preview cost from character length', () => {
    const cost = estimateFromPrompt('minimax', 100)

    expect(cost).toBeCloseTo(0.000075, 8)
  })
})
