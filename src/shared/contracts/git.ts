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
