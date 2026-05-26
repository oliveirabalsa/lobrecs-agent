import type { ImageAttachment, ModelTier, SupportedAgentId } from './agents'

export interface MultitaskTask {
  id: string
  title: string
  description: string
  tier: ModelTier
  agentId: SupportedAgentId
  model: string
  estimatedCostUsd?: number
  dependsOn?: string[]
}

export interface MultitaskPlan {
  planId: string
  originalPrompt: string
  tasks: MultitaskTask[]
  totalEstimatedCostUsd: number
  decomposedBy: {
    agentId: SupportedAgentId
    model: string
  }
}

export interface MultitaskDecomposeRequest {
  projectId: string
  prompt: string
  threadId?: string
  imageAttachments?: ImageAttachment[]
}

export interface MultitaskDecomposeResult {
  plan: MultitaskPlan
  sessionId: string
  threadId: string
}

export interface MultitaskExecuteRequest {
  projectId: string
  planId: string
  threadId?: string
  tasks: MultitaskTask[]
  imageAttachments?: ImageAttachment[]
}

export interface MultitaskDecisionPayload {
  planId: string
  sessionId: string
  decision: 'approve' | 'reject' | 'edit'
  editedTasks?: MultitaskTask[]
}
