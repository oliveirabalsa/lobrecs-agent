import { describe, expect, it } from 'vitest'
import {
  permissionModeForApprovalMode,
  runtimeSettingsWithApprovalMode,
  runtimeSettingsWithThinkingLevel,
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

describe('runtimeSettingsWithThinkingLevel', () => {
  const runtimeSettings: AgentRuntimeSettings = {
    enabled: true,
    command: 'codex',
    permissionMode: 'dangerous',
    extraArgs: ['--foo', '--effort', 'low', '-c', 'model_reasoning_effort="low"'],
  }

  it('maps Codex thinking levels to the current config override flag', () => {
    expect(runtimeSettingsWithThinkingLevel(runtimeSettings, 'codex', 'xhigh')).toEqual({
      enabled: true,
      command: 'codex',
      permissionMode: 'dangerous',
      extraArgs: ['--foo', '--effort', 'low', '-c', 'model_reasoning_effort="xhigh"'],
    })
  })

  it('maps Claude thinking levels to --effort and supports max', () => {
    expect(runtimeSettingsWithThinkingLevel(runtimeSettings, 'claude-code', 'max')).toEqual({
      enabled: true,
      command: 'codex',
      permissionMode: 'dangerous',
      extraArgs: ['--foo', '-c', 'model_reasoning_effort="low"', '--effort', 'max'],
    })
  })

  it('leaves unsupported agents unchanged', () => {
    expect(runtimeSettingsWithThinkingLevel(runtimeSettings, 'antigravity', 'high')).toBe(
      runtimeSettings,
    )
  })
})

describe('runtimeSettingsWithApprovalMode', () => {
  const runtimeSettings: AgentRuntimeSettings = {
    enabled: true,
    command: 'codex',
    permissionMode: 'read-only',
    extraArgs: ['-c', 'model_reasoning_effort="low"'],
  }

  it('overrides only permission mode when a composer mode is provided', () => {
    expect(runtimeSettingsWithApprovalMode(runtimeSettings, 'full', 'ask-for-approval')).toEqual({
      enabled: true,
      command: 'codex',
      permissionMode: 'dangerous',
      extraArgs: ['-c', 'model_reasoning_effort="low"'],
    })
  })

  it('uses the fallback permission mode when no composer mode is provided', () => {
    expect(
      runtimeSettingsWithApprovalMode(runtimeSettings, undefined, 'ask-for-approval'),
    ).toEqual({
      enabled: true,
      command: 'codex',
      permissionMode: 'ask-for-approval',
      extraArgs: ['-c', 'model_reasoning_effort="low"'],
    })
  })
})
