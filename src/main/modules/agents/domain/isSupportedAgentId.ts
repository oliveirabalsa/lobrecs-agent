import { SUPPORTED_AGENT_IDS, type AgentId, type SupportedAgentId } from '../../../../shared/types'

export function isSupportedAgentId(
  agentId: AgentId | string | undefined,
): agentId is SupportedAgentId {
  return typeof agentId === 'string' && SUPPORTED_AGENT_IDS.includes(agentId as SupportedAgentId)
}
