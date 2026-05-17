import type { AgentId, SupportedAgentId } from '../../../../shared/types'

export function isSupportedAgentId(
  agentId: AgentId | string | undefined,
): agentId is SupportedAgentId {
  return agentId === 'claude-code' || agentId === 'codex' || agentId === 'opencode'
}
