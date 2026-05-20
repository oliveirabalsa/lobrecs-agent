export type AgentId = 'claude-code' | 'codex' | 'opencode' | 'gemini' | 'cursor'
export type SupportedAgentId = Exclude<AgentId, 'cursor'>

export type ModelTier = 'lightweight' | 'balanced' | 'advanced' | 'frontier'

export const SUPPORTED_AGENT_IDS = [
  'claude-code',
  'codex',
  'opencode',
  'gemini',
] as const satisfies readonly SupportedAgentId[]

export const AGENT_LABELS: Record<SupportedAgentId, string> = {
  'claude-code': 'Claude Code',
  codex: 'OpenAI Codex',
  opencode: 'OpenCode',
  gemini: 'Gemini CLI',
}

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

// ── Enqueue ──────────────────────────────────────────────
/** A message waiting in the per-thread dispatch queue. */
export interface QueuedMessage {
  id: string
  prompt: string
  agentId: AgentId
  model: string
  createdAt: number
}

/** Renderer→main: add a message to the thread queue. */
export interface EnqueueParams {
  threadId: string
  projectId: string
  prompt: string
  agentId?: AgentId
  modelOverride?: string
}

/** Broadcast payload when the queue for a thread changes. */
export interface QueueStatusEvent {
  threadId: string
  pending: QueuedMessage[]
}

// ── Steer ─────────────────────────────────────────────────
/** Renderer→main: cancel the running session and redirect with a new prompt. */
export interface SteerParams {
  sessionId: string
  projectId: string
  prompt: string
  agentId?: AgentId
  modelOverride?: string
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
  gemini: {
    lightweight: 'flash-lite',
    balanced: 'flash',
    advanced: 'pro',
    frontier: 'auto',
  },
}
