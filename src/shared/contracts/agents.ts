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
}

export interface AgentDispatchResult {
  sessionId: string
}

export const MODEL_MAP: Record<SupportedAgentId, Record<ModelTier, string>> = {
  'claude-code': {
    lightweight: 'claude-haiku-4-5-20251001',
    balanced: 'claude-sonnet-4-6',
    advanced: 'claude-opus-4-6',
    frontier: 'claude-opus-4-6',
  },
  codex: {
    lightweight: 'gpt-5.2-codex',
    balanced: 'gpt-5.2-codex',
    advanced: 'gpt-5.4',
    frontier: 'gpt-5.5',
  },
  opencode: {
    lightweight: 'opencode/minimax-m2.5-free',
    balanced: 'minimax/MiniMax-M2.5',
    advanced: 'minimax/MiniMax-M2.7',
    frontier: 'minimax/MiniMax-M2.7',
  },
}
