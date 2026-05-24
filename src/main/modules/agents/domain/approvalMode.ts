import type {
  AgentApprovalMode,
  AgentThinkingLevel,
  AgentPermissionMode,
  AgentRuntimeSettings,
  SupportedAgentId,
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

export function runtimeSettingsWithThinkingLevel(
  runtimeSettings: AgentRuntimeSettings,
  agentId: SupportedAgentId,
  thinking: AgentThinkingLevel | undefined,
): AgentRuntimeSettings {
  if (!thinking || thinking === 'off') return runtimeSettings

  const thinkingArgs = thinkingArgsForAgent(agentId, thinking)
  if (thinkingArgs.length === 0) return runtimeSettings

  return {
    ...runtimeSettings,
    extraArgs: [
      ...withoutThinkingArgs(runtimeSettings.extraArgs, agentId),
      ...thinkingArgs,
    ],
  }
}

function thinkingArgsForAgent(
  agentId: SupportedAgentId,
  thinking: Exclude<AgentThinkingLevel, 'off'>,
): string[] {
  if (agentId === 'claude-code') return ['--effort', thinking]
  if (agentId === 'codex' && thinking !== 'max') {
    return ['-c', `model_reasoning_effort="${thinking}"`]
  }
  return []
}

function withoutThinkingArgs(
  args: readonly string[],
  agentId: SupportedAgentId,
): string[] {
  const result: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]

    if (agentId === 'claude-code' && arg === '--effort') {
      index += 1
      continue
    }

    if (
      agentId === 'codex' &&
      ((arg === '-c' && typeof next === 'string' && next.startsWith('model_reasoning_effort=')) ||
        arg === '--reasoning-effort')
    ) {
      index += 1
      continue
    }

    result.push(arg)
  }

  return result
}
