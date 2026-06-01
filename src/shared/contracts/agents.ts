import type { SpawnedAgentSession } from './sessions'
import {
  assertPlainId,
  assertRecord,
  assertString,
  optionalBoolean,
  optionalOneOf,
  optionalString,
} from './validation'

export type AgentId = 'claude-code' | 'codex' | 'opencode' | 'antigravity' | 'cursor'
export type SupportedAgentId = AgentId

export type ModelTier = 'lightweight' | 'balanced' | 'advanced' | 'frontier'
export type AgentThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const SUPPORTED_AGENT_IDS = [
  'claude-code',
  'codex',
  'opencode',
  'antigravity',
  'cursor',
] as const satisfies readonly SupportedAgentId[]

const AGENT_APPROVAL_MODES = ['manual', 'auto-safe', 'full'] as const
const AGENT_THINKING_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const SPAWNED_AGENT_KINDS = ['swarm', 'quality-repair', 'automation', 'delegation'] as const

export const AGENT_LABELS: Record<AgentId, string> = {
  'claude-code': 'Claude Code',
  codex: 'OpenAI Codex',
  opencode: 'OpenCode',
  antigravity: 'Antigravity CLI',
  cursor: 'Cursor CLI',
}

export interface AgentModel {
  id: string
  label: string
  agentId: SupportedAgentId
  tier: ModelTier
  source: 'api' | 'cli' | 'config' | 'history' | 'fallback'
  description?: string
  defaultThinkingLevel?: Exclude<AgentThinkingLevel, 'off'>
  supportedThinkingLevels?: Array<Exclude<AgentThinkingLevel, 'off'>>
}

export interface AgentAccountInfo {
  status: 'authenticated' | 'unauthenticated' | 'unknown'
  label: string
  detail?: string
}

export interface AgentModelCatalog {
  agentId: SupportedAgentId
  name: string
  installed: boolean
  models: AgentModel[]
  account?: AgentAccountInfo
  error?: string
}

export type AgentApprovalMode = 'manual' | 'auto-safe' | 'full'

export interface AgentDispatchParams {
  projectId: string
  prompt: string
  profileId?: string
  agentId?: AgentId
  modelOverride?: string
  approvalMode?: AgentApprovalMode
  imageAttachments?: ImageAttachment[]
  /** Internal UI-orchestration marker for real spawned agents such as swarms. */
  spawnedAgent?: SpawnedAgentSession
  /** When provided, links the new session to an existing thread instead of creating one. */
  threadId?: string
  /**
   * When true, the agent first produces an implementation plan and stops.
   * Execution is gated behind an explicit user approval (see
   * `AgentPlanReviewDecisionPayload`).
   */
  planMode?: boolean
  thinking?: AgentThinkingLevel
}

export interface AgentDispatchResult {
  sessionId: string
  threadId: string
}

export interface AgentDelegateTaskParams {
  projectId: string
  threadId: string
  parentSessionId: string
  goal: string
  context?: string
  profileId?: string
  approvalMode?: AgentApprovalMode
  thinking?: AgentThinkingLevel
}

export interface AgentDelegateTaskResult extends AgentDispatchResult {
  delegationId: string
  agentId: SupportedAgentId
  model: string
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

/**
 * A file handed to the agent as context. Despite the historical name, this
 * carries *any* attachment type — the agent receives `filePath` (a copy in the
 * scratch dir) and reads it directly. Image-specific behaviors (the
 * supports-images model gate, Codex `--image` args, the thumbnail preview)
 * branch on {@link isImageAttachment}; everything else treats it generically.
 */
export interface ImageAttachment {
  filePath: string
  name?: string
  mimeType?: string
  size?: number
}

/**
 * True when an attachment is an image the model can ingest visually. Used to
 * gate image-only behaviors; non-image files are passed to the agent by path
 * instead and never force an image-capable model/agent.
 */
export function isImageAttachment(attachment: Pick<ImageAttachment, 'mimeType'>): boolean {
  return attachment.mimeType?.startsWith('image/') ?? false
}

// ── Enqueue ──────────────────────────────────────────────
/** A message waiting in the per-thread dispatch queue. */
export interface QueuedMessage {
  id: string
  prompt: string
  agentId: AgentId
  model: string
  profileId?: string
  approvalMode?: AgentApprovalMode
  thinking?: AgentThinkingLevel
  createdAt: number
}

/** Renderer→main: add a message to the thread queue. */
export interface EnqueueParams {
  threadId: string
  projectId: string
  prompt: string
  profileId?: string
  agentId?: AgentId
  modelOverride?: string
  approvalMode?: AgentApprovalMode
  thinking?: AgentThinkingLevel
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
  profileId?: string
  agentId?: AgentId
  modelOverride?: string
  approvalMode?: AgentApprovalMode
  thinking?: AgentThinkingLevel
}

export function validateAgentDispatchParams(input: unknown): AgentDispatchParams {
  const value = assertRecord(input, 'Agent dispatch input')
  return {
    projectId: assertPlainId(value.projectId, 'Project id'),
    prompt: assertString(value.prompt, 'Prompt', { maxLength: 200_000 }),
    profileId: optionalString(value.profileId, 'Agent profile id', { maxLength: 200 }),
    agentId: optionalOneOf(value.agentId, 'Agent id', SUPPORTED_AGENT_IDS),
    modelOverride: optionalString(value.modelOverride, 'Model override', { maxLength: 500 }),
    approvalMode: optionalOneOf(value.approvalMode, 'Approval mode', AGENT_APPROVAL_MODES),
    imageAttachments: validateImageAttachments(value.imageAttachments),
    spawnedAgent: validateSpawnedAgent(value.spawnedAgent),
    threadId: value.threadId === undefined ? undefined : assertPlainId(value.threadId, 'Thread id'),
    planMode: optionalBoolean(value.planMode, 'Plan mode'),
    thinking: optionalOneOf(value.thinking, 'Thinking level', AGENT_THINKING_LEVELS),
  }
}

export function validateEnqueueParams(input: unknown): EnqueueParams {
  const value = assertRecord(input, 'Agent enqueue input')
  return {
    threadId: assertPlainId(value.threadId, 'Thread id'),
    projectId: assertPlainId(value.projectId, 'Project id'),
    prompt: assertString(value.prompt, 'Prompt', { maxLength: 200_000 }),
    profileId: optionalString(value.profileId, 'Agent profile id', { maxLength: 200 }),
    agentId: optionalOneOf(value.agentId, 'Agent id', SUPPORTED_AGENT_IDS),
    modelOverride: optionalString(value.modelOverride, 'Model override', { maxLength: 500 }),
    approvalMode: optionalOneOf(value.approvalMode, 'Approval mode', AGENT_APPROVAL_MODES),
    thinking: optionalOneOf(value.thinking, 'Thinking level', AGENT_THINKING_LEVELS),
  }
}

export function validateSteerParams(input: unknown): SteerParams {
  const value = assertRecord(input, 'Agent steer input')
  return {
    sessionId: assertPlainId(value.sessionId, 'Session id'),
    projectId: assertPlainId(value.projectId, 'Project id'),
    prompt: assertString(value.prompt, 'Prompt', { maxLength: 200_000 }),
    profileId: optionalString(value.profileId, 'Agent profile id', { maxLength: 200 }),
    agentId: optionalOneOf(value.agentId, 'Agent id', SUPPORTED_AGENT_IDS),
    modelOverride: optionalString(value.modelOverride, 'Model override', { maxLength: 500 }),
    approvalMode: optionalOneOf(value.approvalMode, 'Approval mode', AGENT_APPROVAL_MODES),
    thinking: optionalOneOf(value.thinking, 'Thinking level', AGENT_THINKING_LEVELS),
  }
}

function validateImageAttachments(value: unknown): ImageAttachment[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new Error('Image attachments must be an array.')
  if (value.length > 20) throw new Error('Too many image attachments.')

  return value.map((item, index) => {
    const attachment = assertRecord(item, `Image attachment ${index + 1}`)
    const rawSize = attachment.size
    if (
      rawSize !== undefined &&
      (typeof rawSize !== 'number' || !Number.isFinite(rawSize) || rawSize < 0)
    ) {
      throw new Error(`Image attachment ${index + 1} has an invalid size.`)
    }
    const size = typeof rawSize === 'number' ? rawSize : undefined

    return {
      filePath: assertString(attachment.filePath, `Image attachment ${index + 1} path`, {
        maxLength: 4096,
      }),
      name: optionalString(attachment.name, `Image attachment ${index + 1} name`, {
        maxLength: 255,
      }),
      mimeType: optionalString(attachment.mimeType, `Image attachment ${index + 1} MIME type`, {
        maxLength: 100,
      }),
      size,
    }
  })
}

function validateSpawnedAgent(value: unknown): SpawnedAgentSession | undefined {
  if (value === undefined || value === null) return undefined
  const spawned = assertRecord(value, 'Spawned agent')
  return {
    kind: optionalOneOf(spawned.kind, 'Spawned agent kind', SPAWNED_AGENT_KINDS) ?? 'delegation',
    role: assertString(spawned.role, 'Spawned agent role', { maxLength: 120 }),
  }
}

/**
 * Canonical OpenCode provider prefix for the MiniMax Token Plan.
 *
 * MiniMax renamed its Coding Plan to the (multimodal) Token Plan in March 2026
 * and updated the OpenCode provider id from the legacy `minimax-coding-plan/`
 * to `minimax/`. The new id is what `opencode auth login` writes to
 * `~/.local/share/opencode/auth.json` and what `opencode models` emits, so
 * the app must match it to surface M-series models in the picker.
 *
 * See: https://platform.minimax.io/docs/token-plan/opencode
 */
export const OPENCODE_MINIMAX_TOKEN_PLAN_PROVIDER = 'minimax/'

export const MODEL_MAP: Record<SupportedAgentId, Record<ModelTier, string>> = {
  'claude-code': {
    lightweight: 'claude-haiku-4-5-20251001',
    balanced: 'claude-sonnet-4-6',
    advanced: 'claude-opus-4-8',
    frontier: 'claude-opus-4-8',
  },
  codex: {
    lightweight: 'gpt-5.3-codex-spark',
    balanced: 'gpt-5.3-codex',
    advanced: 'gpt-5.4',
    frontier: 'gpt-5.5',
  },
  opencode: {
    lightweight: 'minimax/MiniMax-M2',
    balanced: 'minimax/MiniMax-M2.5',
    advanced: 'minimax/MiniMax-M2.7',
    frontier: 'minimax/MiniMax-M3',
  },
  antigravity: {
    lightweight: 'gemini-2.0-flash-lite',
    balanced: 'gemini-2.5-flash',
    advanced: 'gemini-3.1-pro',
    frontier: 'gemini-3.5-flash',
  },
  cursor: {
    lightweight: 'auto',
    balanced: 'auto',
    advanced: 'auto',
    frontier: 'auto',
  },
}
