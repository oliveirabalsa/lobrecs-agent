import type {
  GitCommitAnalysisResult,
  GitBranchActionInput,
  GitCommandResult,
  GitCommitInput,
  GitCommitDetailRequest,
  GitCommitPlanExecutionInput,
  GitCommitPlanExecutionResult,
  GitDiffRequest,
  GitDiffReviewResult,
  GitFileActionInput,
  GitFileDiffRequest,
  GitFileSelection,
  GitOperationResult,
  GitPendingChanges,
  GitRepositorySnapshot,
  GitRemoteInfo,
  GitSnapshotRequest,
  GitStashActionInput,
  GitStashDetailRequest,
  CreatePullRequestInput,
  CreatePullRequestFromDraftInput,
  CreatePullRequestResult,
  BringThreadToLocalInput,
  CreateBranchHereInput,
  GeneratePullRequestDraftInput,
  GeneratePullRequestDraftResult,
  MoveThreadToWorktreeInput,
  ReviewPullRequestInput,
  SyncPullRequestReviewInput,
  WorktreeDiffPreview,
  WorktreeHandoffRequest,
  WorktreeHandoffState,
} from '../../shared/contracts/git'
import type { IpcInvoker } from './ipc'

export interface GitApi {
  diff(request: GitDiffRequest): Promise<GitCommandResult>
  stage(request: GitFileSelection): Promise<GitCommandResult>
  revert(request: GitFileSelection): Promise<GitCommandResult>
  commit(input: GitCommitInput): Promise<GitOperationResult>
  push(projectId: string): Promise<GitOperationResult>
  getPendingChanges(projectId: string): Promise<GitPendingChanges>
  analyzeCommitPlan(projectId: string): Promise<GitCommitAnalysisResult>
  reviewCurrentDiff(projectId: string, threadId?: string): Promise<GitDiffReviewResult>
  getFingerprint(projectId: string): Promise<{ branch: string; fingerprint: string }>
  executeCommitPlan(input: GitCommitPlanExecutionInput): Promise<GitCommitPlanExecutionResult>
  getRemote(projectId: string): Promise<GitRemoteInfo>
  getPrTemplate(projectId: string): Promise<string>
  getCurrentBranch(projectId: string): Promise<string>
  generatePrDraft(input: GeneratePullRequestDraftInput): Promise<GeneratePullRequestDraftResult>
  createPrFromDraft(input: CreatePullRequestFromDraftInput): Promise<CreatePullRequestResult>
  createPr(input: CreatePullRequestInput): Promise<CreatePullRequestResult>
  reviewPr(input: ReviewPullRequestInput): Promise<GitDiffReviewResult>
  syncPrReview(input: SyncPullRequestReviewInput): Promise<GitDiffReviewResult>
  createBranch(projectId: string, branchName: string): Promise<GitCommandResult>
  checkoutBranch(projectId: string, branchName: string): Promise<GitOperationResult>
  listBranches(projectId: string): Promise<string[]>
  pull(projectId: string): Promise<GitOperationResult>
  fetch(projectId: string): Promise<GitOperationResult>
  getSnapshot(request: GitSnapshotRequest): Promise<GitRepositorySnapshot>
  getFileDiff(request: GitFileDiffRequest): Promise<GitOperationResult>
  getWorktreeHandoffState(request: WorktreeHandoffRequest): Promise<WorktreeHandoffState>
  previewWorktreeHandoff(request: WorktreeHandoffRequest): Promise<WorktreeDiffPreview>
  moveThreadToWorktree(input: MoveThreadToWorktreeInput): Promise<WorktreeHandoffState>
  bringThreadToLocal(input: BringThreadToLocalInput): Promise<WorktreeHandoffState>
  createBranchHere(input: CreateBranchHereInput): Promise<WorktreeHandoffState>
  restoreWorktreeSnapshot(request: WorktreeHandoffRequest): Promise<WorktreeHandoffState>
  openWorktree(request: WorktreeHandoffRequest): Promise<WorktreeHandoffState>
  getCommitDetail(request: GitCommitDetailRequest): Promise<GitOperationResult>
  getStashDetail(request: GitStashDetailRequest): Promise<GitOperationResult>
  stageFile(input: GitFileActionInput): Promise<GitOperationResult>
  unstageFile(input: GitFileActionInput): Promise<GitOperationResult>
  stageAll(projectId: string): Promise<GitOperationResult>
  unstageAll(projectId: string): Promise<GitOperationResult>
  deleteBranch(input: GitBranchActionInput): Promise<GitOperationResult>
  discardFile(input: GitFileActionInput): Promise<GitOperationResult>
  checkoutBranchAction(input: GitBranchActionInput): Promise<GitOperationResult>
  applyStash(input: GitStashActionInput): Promise<GitOperationResult>
  popStash(input: GitStashActionInput): Promise<GitOperationResult>
  dropStash(input: GitStashActionInput): Promise<GitOperationResult>
}

export function createGitApi(ipcRenderer: IpcInvoker): GitApi {
  const api: GitApi = {
    diff: (request) => ipcRenderer.invoke('git:diff', request),
    stage: (request) => ipcRenderer.invoke('git:stage', request),
    revert: (request) => ipcRenderer.invoke('git:revert', request),
    commit: (input) => ipcRenderer.invoke('git:commit', input),
    push: (projectId) => ipcRenderer.invoke('git:push', projectId),
    getPendingChanges: (projectId) => ipcRenderer.invoke('git:get-pending-changes', projectId),
    analyzeCommitPlan: (projectId) => ipcRenderer.invoke('git:analyze-commit-plan', projectId),
    reviewCurrentDiff: (projectId, threadId) =>
      ipcRenderer.invoke('git:review-current-diff', projectId, threadId),
    getFingerprint: (projectId) => ipcRenderer.invoke('git:get-fingerprint', projectId),
    executeCommitPlan: (input) => ipcRenderer.invoke('git:execute-commit-plan', input),
    getRemote: (projectId) => ipcRenderer.invoke('git:get-remote', projectId),
    getPrTemplate: (projectId) => ipcRenderer.invoke('git:get-pr-template', projectId),
    getCurrentBranch: (projectId) => ipcRenderer.invoke('git:get-current-branch', projectId),
    generatePrDraft: (input) => ipcRenderer.invoke('git:generate-pr-draft', input),
    createPrFromDraft: (input) => ipcRenderer.invoke('git:create-pr-from-draft', input),
    createPr: (input) => ipcRenderer.invoke('git:create-pr', input),
    reviewPr: (input) => ipcRenderer.invoke('git:review-pr', input),
    syncPrReview: (input) => ipcRenderer.invoke('git:sync-pr-review', input),
    createBranch: (projectId, branchName) => ipcRenderer.invoke('git:create-branch', projectId, branchName),
    checkoutBranch: (projectId, branchName) => ipcRenderer.invoke('git:checkout-branch', projectId, branchName),
    listBranches: (projectId) => ipcRenderer.invoke('git:list-branches', projectId),
    pull: (projectId) => ipcRenderer.invoke('git:pull', projectId),
    fetch: (projectId) => ipcRenderer.invoke('git:fetch', projectId),
    getSnapshot: (request) => ipcRenderer.invoke('git:get-snapshot', request),
    getFileDiff: (request) => ipcRenderer.invoke('git:get-file-diff', request),
    getWorktreeHandoffState: (request) =>
      ipcRenderer.invoke('git:get-worktree-handoff-state', request),
    previewWorktreeHandoff: (request) =>
      ipcRenderer.invoke('git:preview-worktree-handoff', request),
    moveThreadToWorktree: (input) =>
      ipcRenderer.invoke('git:move-thread-to-worktree', input),
    bringThreadToLocal: (input) => ipcRenderer.invoke('git:bring-thread-to-local', input),
    createBranchHere: (input) => ipcRenderer.invoke('git:create-branch-here', input),
    restoreWorktreeSnapshot: (request) =>
      ipcRenderer.invoke('git:restore-worktree-snapshot', request),
    openWorktree: (request) => ipcRenderer.invoke('git:open-worktree', request),
    getCommitDetail: (request) => ipcRenderer.invoke('git:get-commit-detail', request),
    getStashDetail: (request) => ipcRenderer.invoke('git:get-stash-detail', request),
    stageFile: (input) => ipcRenderer.invoke('git:stage-file', input),
    unstageFile: (input) => ipcRenderer.invoke('git:unstage-file', input),
    stageAll: (projectId) => ipcRenderer.invoke('git:stage-all', projectId),
    unstageAll: (projectId) => ipcRenderer.invoke('git:unstage-all', projectId),
    deleteBranch: (input) => ipcRenderer.invoke('git:delete-branch', input),
    discardFile: (input) => ipcRenderer.invoke('git:discard-file', input),
    checkoutBranchAction: (input) => ipcRenderer.invoke('git:checkout-branch-action', input),
    applyStash: (input) => ipcRenderer.invoke('git:apply-stash', input),
    popStash: (input) => ipcRenderer.invoke('git:pop-stash', input),
    dropStash: (input) => ipcRenderer.invoke('git:drop-stash', input),
  }

  return api
}
