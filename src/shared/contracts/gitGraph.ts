export interface GitGraphCommit {
  sha: string
  shortSha: string
  message: string
  author: string
  date: string
}

export type GitBranchMergeStatus = 'clean' | 'behind' | 'diverged' | 'ahead-only'

export interface GitBranchNode {
  branch: string
  isDefault: boolean
  headSha: string
  baseCommitSha: string
  aheadCount: number
  behindCount: number
  dirtyFileCount: number
  firstCommitDate: string
  mergeStatus: GitBranchMergeStatus
  recentCommits: GitGraphCommit[]
  sessionId?: string
  worktreePath?: string
}

export interface GitGraphData {
  projectId: string
  defaultBranch: string
  capturedAt: string
  nodes: GitBranchNode[]
}

export interface GitGraphRequest {
  projectId: string
}
