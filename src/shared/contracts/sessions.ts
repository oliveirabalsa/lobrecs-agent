import type { AgentId, ImageAttachment, SupportedAgentId } from './agents'
import type { ApprovalRequest } from './diffs'
import type { MultitaskTask } from './multitask'

export type SessionStatus =
  | 'running'
  | 'awaiting-approval'
  | 'awaiting-input'
  | 'done'
  | 'error'
  | 'cancelled'

export type SpawnedAgentKind = 'swarm' | 'quality-repair' | 'automation' | 'delegation'

export interface SpawnedAgentSession {
  kind: SpawnedAgentKind
  role: string
}

export interface Session {
  id: string
  projectId: string
  threadId?: string
  agentId: AgentId
  model: string
  prompt: string
  imageAttachments?: ImageAttachment[]
  planMode?: boolean
  spawnedAgent?: SpawnedAgentSession
  status: SessionStatus
  tokensIn: number
  tokensOut: number
  costUsd: number
  createdAt: number
  completedAt?: number
}

export interface UserQuestionPromptOption {
  id: string
  label: string
  description?: string
}

export interface UserQuestionPromptQuestion {
  id: string
  header?: string
  question: string
  multiSelect: boolean
  options: UserQuestionPromptOption[]
}

export type AgentActivity =
  | {
      kind: 'message'
      role: 'assistant' | 'system'
      text: string
      stream?: boolean
    }
  | {
      kind: 'step'
      title: string
      detail?: string
      status: 'pending' | 'running' | 'done' | 'error'
    }
  | {
      kind: 'tool-call'
      name: string
      input?: unknown
      status: 'running' | 'done' | 'error'
    }
  | {
      kind: 'tool-result'
      name: string
      output?: string
      status: 'done' | 'error'
    }
  | {
      kind: 'command'
      command: string
      cwd?: string
      status: 'pending' | 'running' | 'done' | 'error'
    }
  | {
      kind: 'file-change'
      filePath: string
      changeType: 'added' | 'modified' | 'deleted'
      additions?: number
      deletions?: number
      status: 'pending' | 'applied' | 'approved' | 'rejected' | 'conflict'
    }
  | {
      kind: 'approval'
      request: ApprovalRequest
      status: 'pending' | 'approved' | 'rejected'
    }
  | {
      kind: 'diff-summary'
      filesChanged: number
      additions: number
      deletions: number
      summary: string
    }
  | {
      kind: 'completion'
      status: SessionStatus
      summary: string
      tokensIn?: number
      tokensOut?: number
      costUsd?: number
    }
  | {
      kind: 'compaction'
      at: number
    }
  | {
      kind: 'plan-prompt'
      promptId: string
      title: string
      options: Array<{ id: string; label: string }>
      allowFreeText?: boolean
    }
  | {
      /**
       * Emitted when a plan-mode session finishes producing its plan. The
       * renderer pairs this with an inline Approve/Reject card; the agent does
       * not execute until the user approves via `agent:plan-review-decision`.
       */
      kind: 'plan-review'
      /** Identifier echoed back in `AgentPlanReviewDecisionPayload`. */
      reviewId: string
      /** Agent that produced the plan — used by the review card to scope the model picker. */
      agentId: string
      /** Model that produced the plan — used as the default in the review card's model picker. */
      model: string
    }
  | {
      kind: 'user-question'
      promptId: string
      title: string
      questions: UserQuestionPromptQuestion[]
    }
  | {
      /**
       * Emitted by the swarm orchestrator after a sequential step finishes
       * when the step had `requireApprovalAfter: true`. The renderer renders
       * an inline Continue/Cancel card; the orchestrator does not dispatch
       * the next agent until the user responds via
       * `swarm:step-approval-decision`.
       */
      kind: 'swarm-step-approval'
      /** Identifier echoed back in `SwarmStepApprovalDecisionPayload`. */
      approvalId: string
      /** The just-completed agent's role (e.g. "planner"). */
      completedRole: string
      /** The next agent's role (e.g. "implementer"). */
      nextRole: string
      /** Next agent id — used by the model picker. */
      nextAgentId: string
      /** Next agent model — used as the model picker default. */
      nextModel: string
      /**
       * The next agent's planned promptSuffix. Surfaced in the editor so the
       * user can refine instructions before continuing.
       */
      nextPromptSuffix?: string
    }
  | {
      /**
       * Emitted when an agent stops because its provider/model limit was hit.
       * The renderer shows an inline model picker and calls
       * `agent:model-recovery-decision` to continue on the same thread.
       */
      kind: 'model-recovery'
      /** Identifier echoed back in `AgentModelRecoveryDecisionPayload`. */
      recoveryId: string
      /** Agent that failed because of the provider/model limit. */
      failedAgentId: string
      /** Model that failed because of the provider/model limit. */
      failedModel: string
      /** Human-readable provider error, safe to show in the review card. */
      reason: string
      /** True when the continuation model must support image inputs. */
      requiresImageSupport?: boolean
    }
  | {
      /**
       * Mirrors the lifecycle of a background delegated child session onto the
       * parent turn. The child session owns execution; this activity is a
       * compact status card for the parent stream.
       */
      kind: 'delegation'
      delegationId: string
      childSessionId: string
      childThreadId: string
      goal: string
      status: 'running' | 'done' | 'error' | 'cancelled'
      agentId: string
      model: string
      lastOutput?: string
      summary?: string
      error?: string
    }
  | {
      kind: 'multitask-plan'
      planId: string
      tasks: MultitaskTask[]
      totalEstimatedCostUsd: number
      decomposedBy: { agentId: SupportedAgentId; model: string }
      originalPrompt: string
    }
  | {
      kind: 'todo-list'
      items: TodoItem[]
    }

export interface TodoItem {
  id: string
  text: string
  completed: boolean
}

export interface AgentEvent {
  type:
    | 'stdout'
    | 'stderr'
    | 'activity'
    | 'approval-request'
    | 'diff'
    | 'session-complete'
    | 'error'
  sessionId: string
  payload: unknown | AgentActivity
  timestamp: number
}

export interface SessionForkPayload {
  prompt: string
  agentId: AgentId
  model: string
}

export interface ThreadTranscriptTurn {
  sessionId: string
  threadId: string
  prompt: string
  imageAttachments?: ImageAttachment[]
  events: AgentEvent[]
  assistantText?: string
  status: SessionStatus
  createdAt: number
  completedAt?: number
}

export interface ListThreadTranscriptOptions {
  limit?: number
  excludeSessionId?: string
  excludeSpawnedAgents?: boolean
}
