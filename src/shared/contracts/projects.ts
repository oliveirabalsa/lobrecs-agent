import type { AgentId, ModelTier } from './agents'

export interface Project {
  id: string
  name: string
  repoPath: string
  agentId: AgentId
  modelTier: ModelTier
  createdAt: number
  updatedAt: number
}
