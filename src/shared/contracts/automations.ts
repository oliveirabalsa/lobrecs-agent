import type { AgentId } from './agents'

export type AutomationStatus = 'scheduled' | 'due' | 'overdue' | 'running' | 'paused' | 'invalid'
export type AutomationReviewState = 'unread' | 'acknowledged' | 'reviewed'
export type AutomationRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type AutomationRunTrigger = 'schedule' | 'manual' | 'retry'

export interface Automation {
  id: string
  projectId: string
  projectIds?: string[]
  name: string
  prompt: string
  schedule: string
  agentId: AgentId
  enabled: boolean
  lastRunAt?: number
  nextRunAt?: number
  status: AutomationStatus
  reviewState: AutomationReviewState
  hasUnreadRuns: boolean
  unreadRunCount: number
  createdAt: number
}

export interface CreateAutomationInput {
  projectId: string
  projectIds?: string[]
  name: string
  prompt: string
  schedule: string
  agentId: AgentId
  enabled: boolean
}

export interface UpdateAutomationInput {
  projectId?: string
  projectIds?: string[]
  name?: string
  prompt?: string
  schedule?: string
  agentId?: AgentId
  enabled?: boolean
}

export interface AutomationRunResult {
  sessionId: string
  runId: string
}

export interface AutomationRun {
  id: string
  automationId: string
  projectId: string
  sessionId?: string
  trigger: AutomationRunTrigger
  status: AutomationRunStatus
  reviewState: AutomationReviewState
  unread: boolean
  attempt: number
  error?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
}

export interface AutomationTriage {
  automations: Automation[]
  runs: AutomationRun[]
}

export interface AutomationSchedulePreview {
  status: AutomationStatus
  nextRunAt?: number
  due: boolean
  overdue: boolean
}
