import type {
  ImageAttachment,
  AgentApprovalMode,
  AgentThinkingLevel,
  Project,
  RoutingDecision,
  SessionStatus,
  SupportedAgentId,
} from '../../../shared/types'

export interface ActiveSessionMeta {
  id: string
  threadId?: string
  prompt: string
  imageAttachments?: ImageAttachment[]
  status: SessionStatus
  routingDecision: RoutingDecision | null
  agentId?: Project['agentId']
  modelOverride?: string
  approvalMode?: AgentApprovalMode
  thinking?: AgentThinkingLevel
  planMode?: boolean
  createdAt?: number
}

/**
 * Summary emitted by the Composer (and previously by `TaskInput`) when a new
 * session is dispatched. Travels up via `onSessionStarted` so the workspace
 * controller can register the session, route it, and seed the tab list.
 */
export interface StartedSessionSummary {
  sessionId: string
  threadId: string
  prompt: string
  imageAttachments?: ImageAttachment[]
  routingDecision: RoutingDecision | null
  agentId?: SupportedAgentId
  modelOverride?: string
  approvalMode?: AgentApprovalMode
  thinking?: AgentThinkingLevel
  planMode?: boolean
  createdAt?: number
}
