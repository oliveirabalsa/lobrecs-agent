import type { AgentId, ModelTier } from './agents'

export interface Project {
  id: string
  name: string
  repoPath: string
  agentId: AgentId
  modelTier: ModelTier
  context?: string | null
  createdAt: number
  updatedAt: number
}
