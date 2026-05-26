import { describe, expect, it } from 'vitest'
import { normalizeSettings, normalizeSettingsPatch } from './validateSettings'

describe('settings validation', () => {
  it('uses managed swarms as the default strategy and first template', () => {
    const settings = normalizeSettings({})

    expect(settings.swarms.defaultStrategy).toBe('managed')
    expect(settings.swarms.templates[0]).toMatchObject({
      id: 'managed-autopilot',
      strategy: 'managed',
      agents: [],
    })
  })

  it('clamps risky limits and falls back to supported agents', () => {
    const settings = normalizeSettings({
      agents: {
        defaultAgentId: 'not-real',
        enabledAgentIds: [],
        imageAttachments: { maxCount: 100, maxSizeMb: 0 },
      },
      swarms: {
        maxAgents: 99,
        maxReviewerIterations: 99,
      },
      verification: {
        selfHealingMaxAttempts: 99,
      },
      routing: {
        tierThresholds: {
          lightweightMax: 95,
          balancedMax: 20,
          advancedMax: 10,
        },
      },
    })

    expect(settings.agents.defaultAgentId).toBe('opencode')
    expect(settings.agents.enabledAgentIds).toEqual(['opencode'])
    expect(settings.agents.imageAttachments.maxCount).toBe(20)
    expect(settings.agents.imageAttachments.maxSizeMb).toBe(1)
    expect(settings.swarms.maxAgents).toBe(16)
    expect(settings.swarms.maxReviewerIterations).toBe(10)
    expect(settings.verification.selfHealingMaxAttempts).toBe(5)
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

  it('merges newer agent defaults into older agent settings', () => {
    const settings = normalizeSettings({
      agents: {
        enabledAgentIds: ['claude-code', 'codex', 'opencode'],
        runtimes: {
          'claude-code': { enabled: true },
          codex: { enabled: true },
          opencode: { enabled: true },
        },
        modelMap: {
          'claude-code': {},
          codex: {},
          opencode: {},
        },
      },
    })

    expect(settings.agents.enabledAgentIds).toContain('antigravity')
    expect(settings.agents.enabledAgentIds).toContain('cursor')
    expect(settings.agents.runtimes.antigravity).toMatchObject({
      enabled: true,
      permissionMode: 'dangerous',
    })
    expect(settings.agents.runtimes.cursor).toMatchObject({
      enabled: true,
      command: '',
      permissionMode: 'dangerous',
      extraArgs: [],
    })
    expect(settings.agents.modelMap.antigravity).toMatchObject({
      lightweight: 'gemini-2.0-flash-lite',
      balanced: 'gemini-2.5-flash',
      advanced: 'gemini-3.1-pro',
      frontier: 'gemini-3.5-flash',
    })
    expect(settings.agents.modelMap.cursor).toEqual({
      lightweight: 'auto',
      balanced: 'auto',
      advanced: 'auto',
      frontier: 'auto',
    })
  })

  it('migrates persisted Gemini settings to Antigravity', () => {
    const settings = normalizeSettings({
      agents: {
        defaultAgentId: 'gemini',
        fallbackAgentId: 'gemini',
        enabledAgentIds: ['claude-code', 'gemini'],
        runtimes: {
          gemini: {
            enabled: false,
            command: '/usr/local/bin/agy',
            permissionMode: 'read-only',
            extraArgs: ['--print-timeout', '10m'],
          },
        },
        modelMap: {
          gemini: {
            lightweight: 'legacy-light',
            balanced: 'legacy-balanced',
            advanced: 'legacy-advanced',
            frontier: 'legacy-frontier',
          },
        },
      },
      swarms: {
        defaultAgents: [{ role: 'researcher', agentId: 'gemini' }],
        templates: [
          {
            id: 'legacy',
            label: 'Legacy',
            strategy: 'parallel',
            agents: [{ role: 'approach', agentId: 'gemini' }],
          },
        ],
      },
      specs: {
        defaultAgentIds: ['gemini'],
      },
    })

    expect(settings.agents.defaultAgentId).toBe('antigravity')
    expect(settings.agents.fallbackAgentId).toBe('antigravity')
    expect(settings.agents.enabledAgentIds).toEqual(['claude-code', 'antigravity'])
    expect(settings.agents.runtimes.antigravity).toMatchObject({
      enabled: false,
      command: '/usr/local/bin/agy',
      permissionMode: 'read-only',
      extraArgs: ['--print-timeout', '10m'],
    })
    expect(settings.agents.modelMap.antigravity).toEqual({
      lightweight: 'legacy-light',
      balanced: 'legacy-balanced',
      advanced: 'legacy-advanced',
      frontier: 'legacy-frontier',
    })
    expect(settings.swarms.defaultAgents).toEqual([
      { role: 'researcher', agentId: 'antigravity' },
    ])
    expect(settings.swarms.templates[0]?.agents).toEqual([
      { role: 'approach', agentId: 'antigravity' },
    ])
    expect(settings.specs.defaultAgentIds).toEqual(['antigravity'])
  })

  it('normalizes Gemini settings patches onto Antigravity keys', () => {
    const patch = normalizeSettingsPatch({
      agents: {
        runtimes: {
          gemini: {
            enabled: false,
            command: '/opt/bin/agy',
          },
        },
      },
    })

    expect(patch).toMatchObject({
      agents: {
        runtimes: {
          antigravity: {
            enabled: false,
            command: '/opt/bin/agy',
          },
        },
      },
    })
  })

  it('preserves managed swarm strategy settings', () => {
    const settings = normalizeSettings({
      swarms: {
        defaultStrategy: 'managed',
        templates: [
          {
            id: 'auto',
            label: 'Autonomous',
            strategy: 'managed',
            agents: [],
          },
        ],
      },
    })

    expect(settings.swarms.defaultStrategy).toBe('managed')
    expect(settings.swarms.templates[0]).toEqual({
      id: 'auto',
      label: 'Autonomous',
      strategy: 'managed',
      agents: [],
    })
  })
})
