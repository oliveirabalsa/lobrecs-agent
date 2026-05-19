import { describe, expect, it } from 'vitest'
import { normalizeSettings, normalizeSettingsPatch } from './validateSettings'

describe('settings validation', () => {
  it('clamps risky limits and falls back to supported agents', () => {
    const settings = normalizeSettings({
      agents: {
        defaultAgentId: 'cursor',
        enabledAgentIds: [],
        imageAttachments: { maxCount: 100, maxSizeMb: 0 },
      },
      swarms: {
        maxAgents: 99,
        maxReviewerIterations: 99,
      },
      routing: {
        tierThresholds: {
          lightweightMax: 95,
          balancedMax: 20,
          advancedMax: 10,
        },
      },
    })

    expect(settings.agents.defaultAgentId).toBe('claude-code')
    expect(settings.agents.enabledAgentIds).toEqual(['claude-code'])
    expect(settings.agents.imageAttachments.maxCount).toBe(20)
    expect(settings.agents.imageAttachments.maxSizeMb).toBe(1)
    expect(settings.swarms.maxAgents).toBe(16)
    expect(settings.swarms.maxReviewerIterations).toBe(10)
    expect(settings.routing.tierThresholds).toEqual({
      lightweightMax: 95,
      balancedMax: 96,
      advancedMax: 97,
    })
  })

  it('normalizes settings patches without preserving default-only values', () => {
    const patch = normalizeSettingsPatch({
      ui: { compactMode: true },
      verification: {
        recipes: [
          {
            id: 'custom',
            label: 'Custom',
            command: 'npm test',
            scope: 'not-real',
          },
        ],
      },
    })

    expect(patch).toMatchObject({
      ui: { compactMode: true },
      verification: {
        recipes: [
          {
            id: 'custom',
            label: 'Custom',
            command: 'npm test',
            scope: 'custom',
          },
        ],
      },
    })
  })
})
