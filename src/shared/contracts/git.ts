import type { SupportedAgentId } from './agents'

export type DiffScope = 'working-tree' | 'staged' | 'head'

export interface GitDiffRequest {
  projectId: string
  scope?: DiffScope
}

export interface GitCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface GitFileSelection {
  projectId: string
  paths?: string[]
}

export interface GitCommitInput {
  projectId: string
  message: string
}

export type GitFileChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'type-changed'

export interface GitChangedFile {
  path: string
  status: GitFileChangeStatus
  previousPath?: string
}

export interface GitCommitSuggestion {
  id: string
  message: string
  summary: string
  files: string[]
}

export interface GitCommitAnalysisModel {
  agentId: SupportedAgentId
  model: string
}

export interface GitCommitAnalysisResult {
  projectId: string
  fingerprint: string
  branch: string
  statusSummary: string
  analysisSummary: string
  changedFiles: GitChangedFile[]
  suggestions: GitCommitSuggestion[]
  analysis: GitCommitAnalysisModel
}

export interface GitCommitPlanExecutionInput {
  projectId: string
  fingerprint: string
  suggestions: GitCommitSuggestion[]
}

export interface GitExecutedCommit {
  hash: string
  message: string
  files: string[]
}

export interface GitCommitPlanExecutionResult {
  commits: GitExecutedCommit[]
  push: GitCommandResult
}

export interface StagedState {
  projectId: string
  stagedFiles: string[]
  unstagedFiles: string[]
  untrackedFiles: string[]
}

export interface BranchMetadata {
  projectId: string
  currentBranch?: string
  upstreamBranch?: string
  ahead: number
  behind: number
}

export interface WorktreeMetadata {
  path: string
  branch?: string
  head?: string
  detached: boolean
}

export interface PullRequestContext {
  provider: 'github' | 'unknown'
  owner?: string
  repo?: string
  number?: number
  url?: string
  baseBranch?: string
  headBranch?: string
}
