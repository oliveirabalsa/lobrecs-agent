import type { ModelTier, SupportedAgentId } from './agents'

export interface RoutingDecision {
  agentId: SupportedAgentId
  model: string
  tier: ModelTier
  score: number
  reasoning: string
}
