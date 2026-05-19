import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from './defaultSettings'
import { mergeSettings } from './mergeSettings'

describe('mergeSettings', () => {
  it('deep merges objects and replaces arrays', () => {
    const merged = mergeSettings(DEFAULT_APP_SETTINGS, {
      agents: {
        defaultAgentId: 'codex',
      },
      swarms: {
        defaultAgents: [{ role: 'solo', agentId: 'opencode' }],
      },
    })

    expect(merged.agents.defaultAgentId).toBe('codex')
    expect(merged.agents.fallbackAgentId).toBe('claude-code')
    expect(merged.swarms.defaultAgents).toEqual([{ role: 'solo', agentId: 'opencode' }])
  })
})
