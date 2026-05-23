import type { AgentId } from './agents'

export interface PromptEvidenceRecord {
  id: string
  sessionId: string
  projectId: string
  threadId?: string
  agentId: AgentId
  model: string
  prompt: string
  resolvedContext?: string
  adapterContext?: string
  contextBytes: number
  redacted: boolean
  createdAt: number
}

