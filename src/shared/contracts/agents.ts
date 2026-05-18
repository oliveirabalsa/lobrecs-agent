export type AgentId = 'claude-code' | 'codex' | 'opencode' | 'cursor'
export type SupportedAgentId = Exclude<AgentId, 'cursor'>

export type ModelTier = 'lightweight' | 'balanced' | 'advanced' | 'frontier'

export interface AgentModel {
  id: string
  label: string
  agentId: SupportedAgentId
  tier: ModelTier
  source: 'cli' | 'config' | 'history' | 'fallback'
  description?: string
}

export interface AgentModelCatalog {
  agentId: SupportedAgentId
  name: string
  installed: boolean
  models: AgentModel[]
  error?: string
}

export interface AgentDispatchParams {
  projectId: string
  prompt: string
  agentId?: AgentId
  modelOverride?: string
  imageAttachments?: ImageAttachment[]
  /** When provided, links the new session to an existing thread instead of creating one. */
  threadId?: string
}

export interface AgentDispatchResult {
  sessionId: string
  threadId: string
}

/** Renderer→main payload for resolving a plan-prompt awaiting user decision. */
export interface AgentPlanDecisionPayload {
  /** Identifier returned by the matching `plan-prompt` activity event. */
  promptId: string
  sessionId: string
  optionId: string
  freeText?: string
}

export interface ImageAttachment {
  filePath: string
  name?: string
  mimeType?: string
  size?: number
}

export const OPENCODE_MINIMAX_TOKEN_PLAN_PROVIDER = 'minimax-coding-plan/'

export const MODEL_MAP: Record<SupportedAgentId, Record<ModelTier, string>> = {
  'claude-code': {
    lightweight: 'claude-haiku-4-5-20251001',
    balanced: 'claude-sonnet-4-6',
    advanced: 'claude-opus-4-7',
    frontier: 'claude-opus-4-7',
  },
  codex: {
    lightweight: 'gpt-5.3-codex-spark',
    balanced: 'gpt-5.3-codex',
    advanced: 'gpt-5.4',
    frontier: 'gpt-5.5',
  },
  opencode: {
    lightweight: 'minimax-coding-plan/MiniMax-M2',
    balanced: 'minimax-coding-plan/MiniMax-M2.5',
    advanced: 'minimax-coding-plan/MiniMax-M2.7',
    frontier: 'minimax-coding-plan/MiniMax-M2.7',
  },
}
