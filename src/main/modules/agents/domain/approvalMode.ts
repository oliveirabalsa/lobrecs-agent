import type {
  AgentApprovalMode,
  AgentPermissionMode,
  AgentRuntimeSettings,
} from '../../../../shared/types'

export function permissionModeForApprovalMode(
  approvalMode: AgentApprovalMode,
): AgentPermissionMode {
  switch (approvalMode) {
    case 'manual':
      return 'ask-for-approval'
    case 'auto-safe':
      return 'bypass-permissions'
    case 'full':
      return 'dangerous'
  }
}

export function runtimeSettingsWithApprovalMode(
  runtimeSettings: AgentRuntimeSettings,
  approvalMode: AgentApprovalMode | undefined,
  fallbackPermissionMode: AgentPermissionMode,
): AgentRuntimeSettings {
  return {
    ...runtimeSettings,
    permissionMode: approvalMode
      ? permissionModeForApprovalMode(approvalMode)
      : fallbackPermissionMode,
  }
}
