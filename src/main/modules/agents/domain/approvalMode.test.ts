import { describe, expect, it } from 'vitest'
import {
  permissionModeForApprovalMode,
  runtimeSettingsWithApprovalMode,
} from './approvalMode'
import type { AgentRuntimeSettings } from '../../../../shared/types'

describe('permissionModeForApprovalMode', () => {
  it.each([
    ['manual' as const, 'ask-for-approval' as const],
    ['auto-safe' as const, 'bypass-permissions' as const],
    ['full' as const, 'dangerous' as const],
  ])('maps %s composer mode to %s runtime permission mode', (approvalMode, permissionMode) => {
    expect(permissionModeForApprovalMode(approvalMode)).toBe(permissionMode)
  })
})

describe('runtimeSettingsWithApprovalMode', () => {
  const runtimeSettings: AgentRuntimeSettings = {
    enabled: true,
    command: 'codex',
    permissionMode: 'read-only',
    extraArgs: ['--reasoning-effort', 'low'],
  }

  it('overrides only permission mode when a composer mode is provided', () => {
    expect(runtimeSettingsWithApprovalMode(runtimeSettings, 'full', 'ask-for-approval')).toEqual({
      enabled: true,
      command: 'codex',
      permissionMode: 'dangerous',
      extraArgs: ['--reasoning-effort', 'low'],
    })
  })

  it('uses the fallback permission mode when no composer mode is provided', () => {
    expect(
      runtimeSettingsWithApprovalMode(runtimeSettings, undefined, 'ask-for-approval'),
    ).toEqual({
      enabled: true,
      command: 'codex',
      permissionMode: 'ask-for-approval',
      extraArgs: ['--reasoning-effort', 'low'],
    })
  })
})
