import { describe, expect, it } from 'vitest'
import { diffSettingsForProjectOverrides } from './useSettingsDraft'

describe('settings draft normalization', () => {
  it('builds a sparse project override diff from full effective settings', () => {
    const diff = diffSettingsForProjectOverrides(
      {
        agents: { defaultAgentId: 'codex' },
        ui: { compactMode: false, sidebarDefaultWidth: 260 },
      },
      {
        agents: { defaultAgentId: 'claude-code' },
        ui: { compactMode: false, sidebarDefaultWidth: 300 },
      },
    )

    expect(diff).toEqual({
      agents: { defaultAgentId: 'claude-code' },
      ui: { sidebarDefaultWidth: 300 },
    })
  })

  it('does not treat object key order differences as project overrides', () => {
    const diff = diffSettingsForProjectOverrides(
      {
        swarms: {
          templates: [
            {
              id: 'feature',
              label: 'Feature',
              agentIds: ['codex', 'claude-code'],
              defaults: {
                maxAgents: 3,
                approvalMode: 'on-request',
              },
            },
          ],
        },
      },
      {
        swarms: {
          templates: [
            {
              label: 'Feature',
              id: 'feature',
              defaults: {
                approvalMode: 'on-request',
                maxAgents: 3,
              },
              agentIds: ['codex', 'claude-code'],
            },
          ],
        },
      },
    )

    expect(diff).toBeUndefined()
  })

  it('still includes arrays when their item values change', () => {
    const diff = diffSettingsForProjectOverrides(
      {
        agents: {
          enabledAgentIds: ['codex', 'claude-code'],
        },
      },
      {
        agents: {
          enabledAgentIds: ['claude-code', 'codex'],
        },
      },
    )

    expect(diff).toEqual({
      agents: {
        enabledAgentIds: ['claude-code', 'codex'],
      },
    })
  })
})
