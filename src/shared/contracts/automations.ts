import type { AgentId } from './agents'

export interface Automation {
  id: string
  projectId: string
  name: string
  prompt: string
  schedule: string
  agentId: AgentId
  enabled: boolean
  lastRunAt?: number
  createdAt: number
}

export interface AutomationRunResult {
  sessionId: string
}
