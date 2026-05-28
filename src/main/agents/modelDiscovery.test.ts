import { describe, expect, it } from 'vitest'
import {
  fallbackModelsForAgent,
  inferModelTier,
  parseAnthropicModelsResponse,
  parseClaudeCliModels,
  parseCodexModels,
  parseOpenCodeModels,
  pickModelForTier,
  modelSupportsImages,
} from './modelDiscovery'

describe('modelDiscovery', () => {
  it('parses visible Codex models from debug output', () => {
    const models = parseCodexModels(
      JSON.stringify({
        models: [
          {
            slug: 'gpt-5.5',
            display_name: 'GPT-5.5',
            visibility: 'list',
            default_reasoning_level: 'medium',
            supported_reasoning_levels: [
              { effort: 'low' },
              { effort: 'medium' },
              { effort: 'high' },
              { effort: 'xhigh' },
            ],
          },
          { slug: 'internal-model', display_name: 'Internal', visibility: 'hidden' },
        ],
      }),
    )

    expect(models.map((model) => model.id)).toEqual(['gpt-5.5'])
    expect(models[0]).toMatchObject({
      agentId: 'codex',
      tier: 'frontier',
      defaultThinkingLevel: 'medium',
      supportedThinkingLevels: ['low', 'medium', 'high', 'xhigh'],
    })
  })

  it('parses OpenCode models and filters to only minimax-coding-plan provider', () => {
    const models = parseOpenCodeModels(
      [
        'opencode/minimax-m2.5-free',
        'minimax/MiniMax-M2.7',
        'minimax-cn-coding-plan/MiniMax-M2.7',
        'minimax-coding-plan/MiniMax-M2',
        'minimax-coding-plan/MiniMax-M2.5',
        'minimax-coding-plan/MiniMax-M2.7',
        'other-provider/model-1',
      ].join('\n'),
    )

    // Should only include minimax-coding-plan models and other non-minimax providers
    expect(models.map((model) => model.id)).toEqual([
      'minimax-coding-plan/MiniMax-M2',
      'minimax-coding-plan/MiniMax-M2.5',
      'minimax-coding-plan/MiniMax-M2.7',
      'other-provider/model-1',
    ])

    expect(models[0]).toMatchObject({
      label: 'MiniMax-M2 (MiniMax Token Plan)',
      agentId: 'opencode',
    })

    expect(models[2]).toMatchObject({
      label: 'MiniMax-M2.7 (MiniMax Token Plan)',
      agentId: 'opencode',
    })
  })

  it('parses Claude models from CLI and Anthropic API responses', () => {
    expect(
      parseClaudeCliModels(
        [
          'Available models',
          'claude-sonnet-4-6 - Claude Sonnet 4.6',
          'claude-opus-4-8 - Claude Opus 4.8',
        ].join('\n'),
      ).map((model) => [model.id, model.label, model.source]),
    ).toEqual([
      ['claude-sonnet-4-6', 'Claude Sonnet 4.6', 'cli'],
      ['claude-opus-4-8', 'Claude Opus 4.8', 'cli'],
    ])

    expect(
      parseAnthropicModelsResponse({
        data: [
          {
            id: 'claude-opus-4-8',
            display_name: 'Claude Opus 4.8',
            type: 'model',
          },
          {
            id: 'not-claude',
            display_name: 'Other',
            type: 'model',
          },
        ],
      }).map((model) => [model.id, model.label, model.source, model.tier]),
    ).toEqual([
      ['claude-opus-4-8', 'Claude Opus 4.8', 'api', 'frontier'],
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
    expect(inferModelTier('claude-opus-4-8')).toBe('frontier')
    expect(inferModelTier('claude-opus-4-7')).toBe('frontier')
    expect(inferModelTier('minimax-coding-plan/MiniMax-M2.7')).toBe('advanced')
    expect(inferModelTier('gemini-2.5-flash')).toBe('balanced')
    expect(inferModelTier('antigravity-2.5-flash')).toBe('balanced')
    expect(inferModelTier('gemini-2.5-flash-lite')).toBe('lightweight')
    expect(inferModelTier('gemini-3.0-pro')).toBe('advanced')
    expect(inferModelTier('antigravity-3.0-pro')).toBe('advanced')
    expect(inferModelTier('gemini-3.1-pro')).toBe('advanced')
    expect(inferModelTier('antigravity-3.1-pro')).toBe('advanced')
    expect(inferModelTier('gemini-3.0-flash')).toBe('balanced')
    expect(inferModelTier('gemini-3.5-flash')).toBe('frontier')
    expect(inferModelTier('antigravity-3.5-flash')).toBe('frontier')
    expect(inferModelTier('gemini-3.5-pro')).toBe('advanced')
    expect(inferModelTier('auto')).toBe('frontier')
  })

  it('keeps Claude fallback models concrete instead of displaying short aliases', () => {
    const ids = fallbackModelsForAgent('claude-code').map((model) => model.id)

    expect(ids).toContain('claude-opus-4-8')
    expect(ids).not.toContain('opus')
    expect(ids).not.toContain('sonnet')
    expect(ids).not.toContain('haiku')
    expect(fallbackModelsForAgent('claude-code').find((model) => model.id === 'claude-opus-4-8')).toMatchObject({
      supportedThinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    })
  })

  it('provides maintained Antigravity fallback models', () => {
    expect(fallbackModelsForAgent('antigravity').map((model) => model.id)).toEqual([
      'gemini-2.0-flash-lite',
      'gemini-2.5-flash',
      'gemini-3.0-pro',
      'gemini-3.1-pro',
      'gemini-3.5-flash',
    ])
  })

  it('provides safe Cursor fallback models without credential discovery', () => {
    expect(fallbackModelsForAgent('cursor').map((model) => model.id)).toEqual([
      'auto',
      'gpt-5',
      'sonnet-4',
      'sonnet-4-thinking',
    ])
  })

  it('adds Codex fallback thinking metadata', () => {
    expect(fallbackModelsForAgent('codex').find((model) => model.id === 'gpt-5.5')).toMatchObject({
      defaultThinkingLevel: 'medium',
      supportedThinkingLevels: ['low', 'medium', 'high', 'xhigh'],
    })
  })

  describe('modelSupportsImages', () => {
    it('returns true for Gemini and Antigravity models', () => {
      expect(modelSupportsImages('gemini-2.5-flash')).toBe(true)
      expect(modelSupportsImages('antigravity-3.0-pro')).toBe(true)
      expect(modelSupportsImages('google/gemini-2.0-flash-lite')).toBe(true)
    })

    it('returns true for Claude 3+ and Claude Code fallback models', () => {
      expect(modelSupportsImages('claude-3-5-sonnet')).toBe(true)
      expect(modelSupportsImages('claude-haiku-4-5-20251001')).toBe(true)
      expect(modelSupportsImages('claude-opus-4-8')).toBe(true)
      expect(modelSupportsImages('claude-opus-4-7')).toBe(true)
    })

    it('returns true for OpenAI GPT-4/5 models', () => {
      expect(modelSupportsImages('gpt-4o')).toBe(true)
      expect(modelSupportsImages('gpt-5.5')).toBe(true)
    })

    it('returns true for models with vision/VL in their name', () => {
      expect(modelSupportsImages('qwen-vl-max')).toBe(true)
      expect(modelSupportsImages('llama3-vision-70b')).toBe(true)
      expect(modelSupportsImages('internvl-2')).toBe(true)
    })

    it('returns false for text-only models like MiniMax M2', () => {
      expect(modelSupportsImages('minimax-coding-plan/MiniMax-M2')).toBe(false)
      expect(modelSupportsImages('minimax-coding-plan/MiniMax-M2.7')).toBe(false)
      expect(modelSupportsImages('text-davinci-003')).toBe(false)
    })
  })
})
