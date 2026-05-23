export type AgentId = 'claude-code' | 'codex' | 'opencode' | 'antigravity' | 'cursor'
export type SupportedAgentId = Exclude<AgentId, 'cursor'>

export type ModelTier = 'lightweight' | 'balanced' | 'advanced' | 'frontier'

export const SUPPORTED_AGENT_IDS = [
  'claude-code',
  'codex',
  'opencode',
  'antigravity',
] as const satisfies readonly SupportedAgentId[]

export const AGENT_LABELS: Record<SupportedAgentId, string> = {
  'claude-code': 'Claude Code',
  codex: 'OpenAI Codex',
  opencode: 'OpenCode',
  antigravity: 'Antigravity CLI',
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

export type AgentApprovalMode = 'manual' | 'auto-safe' | 'full'

export interface AgentDispatchParams {
  projectId: string
  prompt: string
  agentId?: AgentId
  modelOverride?: string
  approvalMode?: AgentApprovalMode
  imageAttachments?: ImageAttachment[]
  /** When provided, links the new session to an existing thread instead of creating one. */
  threadId?: string
  /**
   * When true, the agent first produces an implementation plan and stops.
   * Execution is gated behind an explicit user approval (see
   * `AgentPlanReviewDecisionPayload`).
   */
  planMode?: boolean
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

/**
 * Renderer→main payload for approving or rejecting a plan produced by a
 * plan-mode session. Echoes the `reviewId` from the matching `plan-review`
 * activity event.
 */
export interface AgentPlanReviewDecisionPayload {
  reviewId: string
  /**
   * The planning session that produced the plan under review. The main
   * process enforces this against the stored review and ignores the decision
   * on a mismatch, guarding against stale or misrouted UI events.
   */
  sessionId: string
  decision: 'approve' | 'reject'
  /**
   * Optional agent override for the execution session. When this differs from
   * the planning agent, `modelOverride` must name a model for this agent.
   */
  agentId?: SupportedAgentId
  /**
   * Optional user-edited plan text captured at approval time. When present,
   * execution follows this edited version instead of relying only on the
   * original assistant plan from thread history.
   */
  editedPlanText?: string
  /**
   * Optional user notes/suggestions to append to execution instructions.
   */
  suggestionText?: string
  /**
   * When set, overrides the model used by the execution session. Defaults to
   * the model that ran the planning session when omitted.
   */
  modelOverride?: string
}

/**
 * Renderer→main payload for resolving a provider/model limit recovery prompt.
 * The failed session is already paused; choosing `continue` dispatches a new
 * session on the same thread using the selected agent/model.
 */
export interface AgentModelRecoveryDecisionPayload {
  /** Identifier echoed from the matching `model-recovery` activity. */
  recoveryId: string
  /** Failed session that emitted the recovery prompt. */
  sessionId: string
  decision: 'continue' | 'cancel'
  /** Agent selected for the continuation run. Required for `continue`. */
  agentId?: SupportedAgentId
  /** Model selected for the continuation run. Required for `continue`. */
  modelOverride?: string
}

/**
 * Renderer→main payload for resolving a `swarm-step-approval` activity. The
 * orchestrator pauses between sequential swarm steps when the previous agent
 * was configured with `requireApprovalAfter`. The user chooses to continue
 * (optionally editing the next agent's promptSuffix or model) or cancel.
 */
export interface SwarmStepApprovalDecisionPayload {
  /** Identifier echoed from the matching `swarm-step-approval` activity. */
  approvalId: string
  /** The session that just completed and emitted the approval prompt. */
  sessionId: string
  decision: 'continue' | 'cancel'
  /**
   * Optional override for the next agent's promptSuffix when continuing. When
   * present and non-empty, the orchestrator replaces the planned suffix for
   * the next step before dispatching it.
   */
  editedPromptSuffix?: string
  /**
   * Optional override for the next agent's model. Defaults to the next
   * agent's configured model when omitted.
   */
  modelOverride?: string
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
  approvalMode?: AgentApprovalMode
  createdAt: number
}

/** Renderer→main: add a message to the thread queue. */
export interface EnqueueParams {
  threadId: string
  projectId: string
  prompt: string
  agentId?: AgentId
  modelOverride?: string
  approvalMode?: AgentApprovalMode
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
  approvalMode?: AgentApprovalMode
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
  antigravity: {
    lightweight: 'gemini-2.0-flash-lite',
    balanced: 'gemini-2.5-flash',
    advanced: 'gemini-3.0-pro',
    frontier: 'gemini-3.5-flash',
  },
}
