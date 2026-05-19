import type { AgentId, ImageAttachment } from './agents'
import type { ApprovalRequest } from './diffs'

export type SessionStatus =
  | 'running'
  | 'awaiting-approval'
  | 'awaiting-input'
  | 'done'
  | 'error'
  | 'cancelled'

export interface Session {
  id: string
  projectId: string
  threadId?: string
  agentId: AgentId
  model: string
  prompt: string
  imageAttachments?: ImageAttachment[]
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
      kind: 'user-question'
      promptId: string
      title: string
      questions: UserQuestionPromptQuestion[]
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
  assistantText?: string
  status: SessionStatus
  createdAt: number
  completedAt?: number
}

export interface ListThreadTranscriptOptions {
  limit?: number
  excludeSessionId?: string
}
