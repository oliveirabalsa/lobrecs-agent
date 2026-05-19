import type {
  GitCommitAnalysisResult,
  GitCommandResult,
  GitCommitInput,
  GitCommitPlanExecutionInput,
  GitCommitPlanExecutionResult,
  GitDiffRequest,
  GitFileSelection,
} from '../../shared/contracts/git'
import type { IpcInvoker } from './ipc'

export interface GitApi {
  diff(request: GitDiffRequest): Promise<GitCommandResult>
  stage(request: GitFileSelection): Promise<GitCommandResult>
  revert(request: GitFileSelection): Promise<GitCommandResult>
  commit(input: GitCommitInput): Promise<GitCommandResult>
  push(projectId: string): Promise<GitCommandResult>
  analyzeCommitPlan(projectId: string): Promise<GitCommitAnalysisResult>
  executeCommitPlan(input: GitCommitPlanExecutionInput): Promise<GitCommitPlanExecutionResult>
}

export function createGitApi(ipcRenderer: IpcInvoker): GitApi {
  return {
    diff: (request) => ipcRenderer.invoke('git:diff', request),
    stage: (request) => ipcRenderer.invoke('git:stage', request),
    revert: (request) => ipcRenderer.invoke('git:revert', request),
    commit: (input) => ipcRenderer.invoke('git:commit', input),
    push: (projectId) => ipcRenderer.invoke('git:push', projectId),
    analyzeCommitPlan: (projectId) => ipcRenderer.invoke('git:analyze-commit-plan', projectId),
    executeCommitPlan: (input) => ipcRenderer.invoke('git:execute-commit-plan', input),
  }
}
