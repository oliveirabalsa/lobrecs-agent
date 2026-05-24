import type {
  GitCommitAnalysisResult,
  GitCommandResult,
  GitCommitInput,
  GitCommitPlanExecutionInput,
  GitCommitPlanExecutionResult,
  GitDiffRequest,
  GitDiffReviewResult,
  GitFileSelection,
  GitPendingChanges,
  GitRemoteInfo,
  CreatePullRequestInput,
  CreatePullRequestFromDraftInput,
  CreatePullRequestResult,
  GeneratePullRequestDraftInput,
  GeneratePullRequestDraftResult,
} from '../../shared/contracts/git'
import type { GitGraphData, GitGraphRequest } from '../../shared/contracts/gitGraph'
import type { IpcInvoker } from './ipc'

export interface GitApi {
  diff(request: GitDiffRequest): Promise<GitCommandResult>
  stage(request: GitFileSelection): Promise<GitCommandResult>
  revert(request: GitFileSelection): Promise<GitCommandResult>
  commit(input: GitCommitInput): Promise<GitCommandResult>
  push(projectId: string): Promise<GitCommandResult>
  getPendingChanges(projectId: string): Promise<GitPendingChanges>
  analyzeCommitPlan(projectId: string): Promise<GitCommitAnalysisResult>
  reviewCurrentDiff(projectId: string, threadId?: string): Promise<GitDiffReviewResult>
  executeCommitPlan(input: GitCommitPlanExecutionInput): Promise<GitCommitPlanExecutionResult>
  getRemote(projectId: string): Promise<GitRemoteInfo>
  getPrTemplate(projectId: string): Promise<string>
  getCurrentBranch(projectId: string): Promise<string>
  generatePrDraft(input: GeneratePullRequestDraftInput): Promise<GeneratePullRequestDraftResult>
  createPrFromDraft(input: CreatePullRequestFromDraftInput): Promise<CreatePullRequestResult>
  createPr(input: CreatePullRequestInput): Promise<CreatePullRequestResult>
  createBranch(projectId: string, branchName: string): Promise<GitCommandResult>
  checkoutBranch(projectId: string, branchName: string): Promise<GitCommandResult>
  listBranches(projectId: string): Promise<string[]>
  pull(projectId: string): Promise<GitCommandResult>
  fetch(projectId: string): Promise<GitCommandResult>
  getGraphData(request: GitGraphRequest): Promise<GitGraphData>
}

export function createGitApi(ipcRenderer: IpcInvoker): GitApi {
  return {
    diff: (request) => ipcRenderer.invoke('git:diff', request),
    stage: (request) => ipcRenderer.invoke('git:stage', request),
    revert: (request) => ipcRenderer.invoke('git:revert', request),
    commit: (input) => ipcRenderer.invoke('git:commit', input),
    push: (projectId) => ipcRenderer.invoke('git:push', projectId),
    getPendingChanges: (projectId) => ipcRenderer.invoke('git:get-pending-changes', projectId),
    analyzeCommitPlan: (projectId) => ipcRenderer.invoke('git:analyze-commit-plan', projectId),
    reviewCurrentDiff: (projectId, threadId) =>
      ipcRenderer.invoke('git:review-current-diff', projectId, threadId),
    executeCommitPlan: (input) => ipcRenderer.invoke('git:execute-commit-plan', input),
    getRemote: (projectId) => ipcRenderer.invoke('git:get-remote', projectId),
    getPrTemplate: (projectId) => ipcRenderer.invoke('git:get-pr-template', projectId),
    getCurrentBranch: (projectId) => ipcRenderer.invoke('git:get-current-branch', projectId),
    generatePrDraft: (input) => ipcRenderer.invoke('git:generate-pr-draft', input),
    createPrFromDraft: (input) => ipcRenderer.invoke('git:create-pr-from-draft', input),
    createPr: (input) => ipcRenderer.invoke('git:create-pr', input),
    createBranch: (projectId, branchName) => ipcRenderer.invoke('git:create-branch', projectId, branchName),
    checkoutBranch: (projectId, branchName) => ipcRenderer.invoke('git:checkout-branch', projectId, branchName),
    listBranches: (projectId) => ipcRenderer.invoke('git:list-branches', projectId),
    pull: (projectId) => ipcRenderer.invoke('git:pull', projectId),
    fetch: (projectId) => ipcRenderer.invoke('git:fetch', projectId),
    getGraphData: (request) => ipcRenderer.invoke('git:get-graph-data', request),
  }
}
