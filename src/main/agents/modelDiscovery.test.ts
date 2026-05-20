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

  it('parses only OpenCode MiniMax token-plan model lines', () => {
    const models = parseOpenCodeModels(
      [
        'opencode/minimax-m2.5-free',
        'minimax/MiniMax-M2.7',
        'minimax-cn-coding-plan/MiniMax-M2.7',
        'minimax-coding-plan/MiniMax-M2',
        'minimax-coding-plan/MiniMax-M2.5',
        'minimax-coding-plan/MiniMax-M2.7',
      ].join('\n'),
    )

    expect(models.map((model) => model.id)).toEqual([
      'minimax-coding-plan/MiniMax-M2',
      'minimax-coding-plan/MiniMax-M2.5',
      'minimax-coding-plan/MiniMax-M2.7',
    ])
  })

  it('picks the closest available model for the requested tier', () => {
    const models = parseOpenCodeModels(
      'minimax-coding-plan/MiniMax-M2\nminimax-coding-plan/MiniMax-M2.7\n',
    )

    expect(pickModelForTier(models, 'frontier')?.id).toBe('minimax-coding-plan/MiniMax-M2.7')
  })

  it('infers tiers for unknown local model names', () => {
    expect(inferModelTier('claude-haiku-4-5-20251001')).toBe('lightweight')
    expect(inferModelTier('claude-opus-4-7')).toBe('frontier')
    expect(inferModelTier('minimax-coding-plan/MiniMax-M2.7')).toBe('advanced')
    expect(inferModelTier('gemini-2.5-flash')).toBe('balanced')
    expect(inferModelTier('antigravity-2.5-flash')).toBe('balanced')
    expect(inferModelTier('gemini-2.5-flash-lite')).toBe('lightweight')
    expect(inferModelTier('gemini-3.0-pro')).toBe('advanced')
    expect(inferModelTier('antigravity-3.0-pro')).toBe('advanced')
    expect(inferModelTier('gemini-3.5-pro')).toBe('frontier')
    expect(inferModelTier('antigravity-3.5-pro')).toBe('frontier')
    expect(inferModelTier('auto')).toBe('frontier')
  })

  it('keeps Claude fallback models concrete instead of displaying short aliases', () => {
    const ids = fallbackModelsForAgent('claude-code').map((model) => model.id)

    expect(ids).toContain('claude-opus-4-7')
    expect(ids).not.toContain('opus')
    expect(ids).not.toContain('sonnet')
    expect(ids).not.toContain('haiku')
  })

  it('provides Antigravity fallback aliases from MODEL_MAP', () => {
    expect(fallbackModelsForAgent('antigravity').map((model) => model.id)).toEqual([
      'gemini-2.0-flash-lite',
      'gemini-2.5-flash',
      'gemini-3.0-pro',
      'gemini-3.5-pro',
    ])
  })
})
