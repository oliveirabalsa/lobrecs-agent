import type {
  AgentModelCatalog,
  ImageAttachment,
  ModelTier,
  RoutingDecision,
  SupportedAgentId,
} from '../../../../../shared/types'

export type ApprovalMode = 'full' | 'auto-safe' | 'manual'

/** `'auto'` = router picks; otherwise pinned to a specific agent + model. */
export type ModelSelection =
  | { kind: 'auto' }
  | { kind: 'manual'; agentId: SupportedAgentId; modelId: string }

export interface AttachedImage {
  id: string
  previewUrl: string
  attachment: ImageAttachment
}

export interface ModelOption {
  key: string
  agentId: SupportedAgentId
  agentName: string
  modelId: string
  label: string
  tier: ModelTier
}

export interface ModelGroup {
  agentId: SupportedAgentId
  label: string
  options: ModelOption[]
}

export type { AgentModelCatalog, ImageAttachment, ModelTier, RoutingDecision, SupportedAgentId }
