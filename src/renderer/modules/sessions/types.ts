import type {
  Project,
  RoutingDecision,
  SessionStatus,
} from '../../../shared/types'

export interface ActiveSessionMeta {
  id: string
  prompt: string
  status: SessionStatus
  routingDecision: RoutingDecision | null
  agentId?: Project['agentId']
  modelOverride?: string
}
