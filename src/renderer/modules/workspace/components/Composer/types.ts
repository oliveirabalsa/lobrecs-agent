import type {
  AgentModelCatalog,
  AgentApprovalMode,
  AgentThinkingLevel,
  ImageAttachment,
  ModelTier,
  RoutingDecision,
  SupportedAgentId,
} from '../../../../../shared/types'

export type ApprovalMode = AgentApprovalMode

/** Reasoning/thinking depth requested for the selected model. */
export type ThinkingLevel = AgentThinkingLevel

/** `'auto'` = router picks; otherwise pinned to a specific agent + model. */
export type ModelSelection =
  | { kind: 'auto'; thinking?: ThinkingLevel }
  | { kind: 'manual'; agentId: SupportedAgentId; modelId: string; thinking?: ThinkingLevel }

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
  defaultThinkingLevel?: Exclude<ThinkingLevel, 'off'>
  supportedThinkingLevels?: Array<Exclude<ThinkingLevel, 'off'>>
}

export interface ModelGroup {
  agentId: SupportedAgentId
  label: string
  options: ModelOption[]
}

export type { AgentModelCatalog, ImageAttachment, ModelTier, RoutingDecision, SupportedAgentId }
