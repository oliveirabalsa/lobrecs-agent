import { describe, expect, it } from 'vitest'
import {
  fallbackModelsForAgent,
  inferModelTier,
  parseCodexModels,
  parseOpenCodeModels,
  pickModelForTier,
} from './modelDiscovery'

describe('modelDiscovery', () => {
  it('parses visible Codex models from debug output', () => {
    const models = parseCodexModels(
      JSON.stringify({
        models: [
          { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' },
          { slug: 'internal-model', display_name: 'Internal', visibility: 'hidden' },
        ],
      }),
    )

    expect(models.map((model) => model.id)).toEqual(['gpt-5.5'])
    expect(models[0]).toMatchObject({ agentId: 'codex', tier: 'frontier' })
  })

  it('parses OpenCode model lines', () => {
    const models = parseOpenCodeModels('opencode/minimax-m2.5-free\nminimax/MiniMax-M2.7\n')

    expect(models.map((model) => model.id)).toEqual([
      'opencode/minimax-m2.5-free',
      'minimax/MiniMax-M2.7',
    ])
  })

  it('picks the closest available model for the requested tier', () => {
    const models = parseOpenCodeModels('opencode/minimax-m2.5-free\nminimax/MiniMax-M2.7\n')

    expect(pickModelForTier(models, 'frontier')?.id).toBe('minimax/MiniMax-M2.7')
  })

  it('infers tiers for unknown local model names', () => {
    expect(inferModelTier('claude-haiku-4-5-20251001')).toBe('lightweight')
    expect(inferModelTier('claude-opus-4-7')).toBe('frontier')
    expect(inferModelTier('minimax/MiniMax-M2.7')).toBe('advanced')
  })

  it('keeps Claude fallback models concrete instead of displaying short aliases', () => {
    const ids = fallbackModelsForAgent('claude-code').map((model) => model.id)

    expect(ids).toContain('claude-opus-4-7')
    expect(ids).not.toContain('opus')
    expect(ids).not.toContain('sonnet')
    expect(ids).not.toContain('haiku')
  })
})
