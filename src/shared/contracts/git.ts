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

export interface GitDiffReviewAnalysis extends GitCommitAnalysisModel {
  sessionId?: string
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

export type GitDiffReviewSeverity = 'critical' | 'high' | 'medium' | 'low'
export type GitDiffReviewCategory =
  | 'bug'
  | 'regression'
  | 'security'
  | 'missing-test'
  | 'verification'

export interface GitDiffReviewFinding {
  id: string
  severity: GitDiffReviewSeverity
  category: GitDiffReviewCategory
  title: string
  detail: string
  filePath?: string
  line?: number
  recommendation?: string
}

export interface GitDiffReviewResult {
  projectId: string
  fingerprint: string
  branch: string
  statusSummary: string
  changedFiles: GitChangedFile[]
  summary: string
  findings: GitDiffReviewFinding[]
  analysis: GitDiffReviewAnalysis
}

/**
 * Lightweight working-tree probe. Unlike `GitCommitAnalysisResult` this never
 * runs an AI agent — it only counts changed files so the UI can decide whether
 * a commit is even possible before opening the Commit & Push dialog.
 */
export interface GitPendingChanges {
  projectId: string
  fileCount: number
  hasChanges: boolean
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
  provider: 'github' | 'azure' | 'unsupported'
  owner?: string
  repo?: string
  number?: number
  url?: string
  baseBranch?: string
  headBranch?: string
}

export type GitProviderType = 'github' | 'azure' | 'unsupported'

export interface GitRemoteInfo {
  url: string
  provider: GitProviderType
  owner: string
  repo: string
}

export interface CreatePullRequestInput {
  projectId: string
  title: string
  body: string
  headBranch: string
  baseBranch: string
}

export interface CreatePullRequestResult {
  url: string
  number: number
}

export interface GeneratePullRequestDraftInput {
  projectId: string
  headBranch: string
  baseBranch: string
}

export interface GeneratePullRequestDraftResult {
  title: string
  body: string
}

export type CreatePullRequestFromDraftInput = CreatePullRequestInput

export interface GitPrTemplateRequest {
  projectId: string
  provider: GitProviderType
}
