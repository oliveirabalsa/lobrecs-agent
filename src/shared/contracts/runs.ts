import type { AgentEvent, SessionStatus } from './sessions'
import type { SupportedAgentId } from './agents'

export type RunMode = 'local' | 'worktree' | 'remote-placeholder'

export type SpecRunStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'reviewing'
  | 'verified'
  | 'failed'
  | 'cancelled'

export type RunAttemptStatus =
  | 'queued'
  | 'running'
  | 'reviewing'
  | 'done'
  | 'failed'
  | 'cancelled'

export type VerificationStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped'

export type VerificationRecipeScope = 'build' | 'test' | 'lint' | 'ui' | 'custom'

export interface AdapterCapability {
  agentId: SupportedAgentId
  name: string
  installed: boolean
  supportsStreamingJson: boolean
  supportsResume: boolean
  supportsFileAttachments: boolean
  supportsCustomAgents: boolean
  supportsMcp: boolean
  supportsApprovalMode: boolean
  supportsModelListing: boolean
}

export type NormalizedAgentEvent =
  | { kind: 'text'; text: string; role?: 'assistant' | 'system' }
  | { kind: 'tool-call'; name: string; input?: unknown }
  | { kind: 'command'; command: string; cwd?: string }
  | { kind: 'file-proposal'; filePath: string; additions?: number; deletions?: number }
  | { kind: 'approval-request'; risk?: 'low' | 'medium' | 'high'; payload: unknown }
  | { kind: 'usage'; tokensIn?: number; tokensOut?: number; costUsd?: number }
  | { kind: 'completion'; status: SessionStatus; payload?: unknown }
  | { kind: 'raw'; event: AgentEvent }

export interface SpecRun {
  id: string
  specId: string
  status: SpecRunStatus
  mode: RunMode
  createdAt: number
  completedAt?: number
}

export interface RunAttempt {
  id: string
  specRunId: string
  sessionId?: string
  agentId: SupportedAgentId
  model?: string
  status: RunAttemptStatus
  costUsd?: number
  durationMs?: number
  risk?: 'low' | 'medium' | 'high'
  createdAt: number
  completedAt?: number
}

export interface VerificationResult {
  id: string
  specRunId: string
  command: string
  status: VerificationStatus
  output?: string
  createdAt: number
  completedAt?: number
}

export interface VerificationRecipe {
  id: string
  label: string
  command: string
  scope: VerificationRecipeScope
  description?: string
}

export interface StartSpecRunInput {
  specId: string
  mode?: RunMode
}

export interface StartSpecRunResult {
  run: SpecRun
  attempts: RunAttempt[]
}

export interface SpecRunComparison {
  specId: string
  runs: SpecRun[]
  attempts: RunAttempt[]
  verificationResults: VerificationResult[]
}

export type RunAuditPhase =
  | 'recipe-started'
  | 'recipe-passed'
  | 'recipe-failed'
  | 'repair-dispatched'
  | 'repair-skipped'
  | 'gate-passed'
  | 'gate-stopped'

export type RunAuditStopReason =
  | 'passed'
  | 'max-attempts'
  | 'repeat-failure'
  | 'no-diff'
  | 'manual-review'
  | 'cancelled'
  | 'repair-in-flight'

export interface RunAuditRecord {
  id: string
  specRunId?: string
  sessionId: string
  threadId?: string
  attempt: number
  phase: RunAuditPhase
  recipeId?: string
  recipeLabel?: string
  command?: string
  exitCode?: number
  outputTail?: string
  changedFiles?: string[]
  repairSessionId?: string
  stopReason?: RunAuditStopReason
  finalStatus?: 'passed' | 'failed' | 'pending'
  createdAt: number
}
