import type {
  ImageAttachment,
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
  createdAt?: number
}
