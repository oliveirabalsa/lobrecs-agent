import { describe, expect, it } from 'vitest'
import type { AgentModelCatalog, SwarmAgentConfig } from '../../../shared/types'
import {
  buildDefaultSwarmAgents,
  DEFAULT_SWARM_AGENT_IDS,
  normalizeSwarmAgents,
  resolveAvailableSwarmAgents,
} from './agentSelection'

describe('SwarmBuilder agent selection', () => {
  it('includes Gemini in the fallback agent set', () => {
    expect(DEFAULT_SWARM_AGENT_IDS).toContain('gemini')
  })

  it('builds default roles across distinct discovered agents', () => {
    const agents = buildDefaultSwarmAgents(['codex', 'opencode'])

    expect(agents).toEqual([
      { role: 'implementer', agentId: 'codex' },
      { role: 'reviewer', agentId: 'opencode' },
    ])
  })

  it('uses installed model catalogs instead of the current fallback agent', () => {
    const catalogs: AgentModelCatalog[] = [
      { agentId: 'claude-code', name: 'Claude Code', installed: false, models: [] },
      { agentId: 'codex', name: 'OpenAI Codex', installed: true, models: [] },
      { agentId: 'opencode', name: 'OpenCode', installed: true, models: [] },
    ]

    expect(
      resolveAvailableSwarmAgents({
        modelCatalogs: catalogs,
        fallbackAgents: ['claude-code'],
        catalogsLoaded: true,
      }),
    ).toEqual(['codex', 'opencode'])
  })

  it('spreads template duplicate roles across available adapters when possible', () => {
    const templateAgents: SwarmAgentConfig[] = [
      { role: 'planner', agentId: 'claude-code' },
      { role: 'implementer', agentId: 'codex' },
      { role: 'reviewer', agentId: 'claude-code' },
    ]

    const normalized = normalizeSwarmAgents(
      templateAgents,
      ['claude-code', 'codex', 'opencode'],
      { spreadDuplicates: true },
    )

    expect(normalized.map((agent) => agent.agentId)).toEqual([
      'claude-code',
      'codex',
      'opencode',
    ])
  })

  it('clears model overrides when an unavailable agent is replaced', () => {
    const normalized = normalizeSwarmAgents(
      [
        {
          role: 'reviewer',
          agentId: 'claude-code',
          modelOverride: 'claude-opus-4-7',
        },
      ],
      ['codex'],
    )

    expect(normalized).toEqual([{ role: 'reviewer', agentId: 'codex' }])
  })
})
