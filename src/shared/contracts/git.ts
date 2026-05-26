import type { SupportedAgentId } from './agents'
import type {
  WorktreeCleanupPolicy,
  WorktreeExecutionLocation,
  WorktreeSessionMetadata,
  WorktreeSnapshotStatus,
} from './runs'

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

export type GitDiffReviewTarget = 'working-tree' | 'branch' | 'pull-request'

export interface GitDiffReviewSource {
  provider: GitProviderType
  url?: string
  prNumber?: number
  repoSlug?: string
  baseBranch?: string
  headBranch?: string
  headSha?: string
}

export interface GitDiffReviewResult {
  projectId: string
  fingerprint: string
  branch: string
  statusSummary: string
  changedFiles: GitChangedFile[]
  summary: string
  findings: GitDiffReviewFinding[]
  rawOutput?: string
  analysis: GitDiffReviewAnalysis
  target?: GitDiffReviewTarget
  source?: GitDiffReviewSource
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

export type WorktreeHandoffCommand =
  | 'move-to-worktree'
  | 'bring-to-local'
  | 'create-branch-here'
  | 'restore-snapshot'
  | 'open-worktree'

export interface WorktreeHandoffState extends WorktreeSessionMetadata {
  command?: WorktreeHandoffCommand
  pendingChangeCount: number
  hasLocalChanges: boolean
  hasWorktreeChanges: boolean
  conflictCheck: 'clean' | 'local-dirty' | 'worktree-missing' | 'unknown'
}

export interface WorktreeHandoffRequest {
  projectId: string
  threadId: string
}

export interface MoveThreadToWorktreeInput extends WorktreeHandoffRequest {
  cleanupPolicy?: WorktreeCleanupPolicy
}

export interface BringThreadToLocalInput extends WorktreeHandoffRequest {
  removeAfterApply?: boolean
}

export interface CreateBranchHereInput extends WorktreeHandoffRequest {
  branchName: string
}

export interface WorktreeDiffPreview extends WorktreeHandoffRequest {
  location: WorktreeExecutionLocation
  worktreePath?: string
  branch?: string
  baseBranch?: string
  baseCommit?: string
  snapshotStatus: WorktreeSnapshotStatus
  cleanupPolicy: WorktreeCleanupPolicy
  changedFiles: GitChangedFile[]
  patch: string
  hasLocalChanges: boolean
  hasConflicts: boolean
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

export interface ReviewPullRequestInput {
  projectId: string
  prNumber: number
  baseBranch?: string
  headBranch?: string
  threadId?: string
}

export interface SyncPullRequestReviewInput {
  projectId: string
  prNumber: number
  threadId?: string
}

export interface PullRequestDiffSnapshot {
  prNumber: number
  url: string
  title: string
  state: 'open' | 'closed' | 'merged'
  baseBranch: string
  headBranch: string
  baseSha: string
  headSha: string
  repoSlug: string
  changedFiles: GitChangedFile[]
  patch: string
  diffStat: string
}

export interface GitPrTemplateRequest {
  projectId: string
  provider: GitProviderType
}

export type GitTuiPanelId = 'status' | 'files' | 'branches' | 'commits' | 'stash'

export type GitFileStage = 'staged' | 'unstaged' | 'untracked'

export type GitWorkspaceFileStatus =
  | GitFileChangeStatus
  | 'unchanged'
  | 'conflicted'
  | 'unknown'

export interface GitBranchState {
  currentBranch?: string
  upstreamBranch?: string
  headSha?: string
  detached: boolean
  ahead: number
  behind: number
}

export interface GitFileEntry {
  id: string
  path: string
  previousPath?: string
  status: GitWorkspaceFileStatus
  staged: boolean
  stagedStatus: GitWorkspaceFileStatus
  unstagedStatus: GitWorkspaceFileStatus
  stage: GitFileStage
  conflict: boolean
}

export interface GitBranchEntry {
  name: string
  current: boolean
  upstream?: string
  headSha?: string
  lastCommitDate?: string
  lastCommitSubject?: string
  ahead: number
  behind: number
}

export interface GitCommitEntry {
  sha: string
  hash: string
  shortSha: string
  shortHash: string
  subject: string
  summary: string
  author: string
  date: string
  refs: string[]
  graph: string
}

export interface GitStashEntry {
  ref: string
  id: string
  index: number
  sha: string
  message: string
  relativeDate: string
  date: string
}

export interface GitRemoteEntry {
  name: string
  url: string
  direction: 'fetch' | 'push'
}

export interface GitOperationState {
  status: 'idle' | 'running' | 'success' | 'error'
  kind?: string
  running?: boolean
  message?: string
  stdout?: string
  stderr?: string
}

export interface GitRepositorySnapshot {
  projectId: string
  repoPath: string
  branch: GitBranchState
  files: GitFileEntry[]
  branches: GitBranchEntry[]
  commits: GitCommitEntry[]
  stash: GitStashEntry[]
  remotes: GitRemoteEntry[]
  capturedAt: string
  operation?: GitOperationState
}

export interface GitSnapshotRequest {
  projectId: string
  commitLimit?: number
}

export interface GitFileDiffRequest {
  projectId: string
  path?: string
}

export interface GitCommitDetailRequest {
  projectId: string
  sha?: string
  hash?: string
}

export interface GitStashDetailRequest {
  projectId: string
  ref?: string
  stashId?: string
}

export interface GitFileActionInput {
  projectId: string
  path: string
}

export interface GitBranchActionInput {
  projectId: string
  branchName: string
}

export interface GitStashActionInput {
  projectId: string
  ref?: string
  stashId?: string
  confirmed?: boolean
}

export interface GitOperationResult extends GitCommandResult {
  ok: boolean
  message: string
  requiresConfirmation?: boolean
}
