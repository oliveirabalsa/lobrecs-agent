import type { GitDiffReviewCategory, GitDiffReviewSeverity, GitDiffReviewTarget } from './git'

export type ReviewIssueProvider =
  | 'local-diff-review'
  | 'github'
  | 'coderabbit'
  | 'local-review'
  | `extension:${string}`

export type ReviewIssueStatus = 'open' | 'fixing' | 'resolved' | 'ignored'

export type ReviewIssueSeverity = GitDiffReviewSeverity

export type ReviewTarget = GitDiffReviewTarget

export type ReviewIssueCategory =
  | GitDiffReviewCategory
  | 'architecture'
  | 'maintainability'
  | 'documentation'

export interface ReviewIssue {
  id: string
  projectId: string
  provider: ReviewIssueProvider
  sourceId: string
  sourceUrl?: string
  specRunId?: string
  sessionId?: string
  threadId?: string
  fingerprint?: string
  branch?: string
  severity: ReviewIssueSeverity
  category: ReviewIssueCategory
  title: string
  detail: string
  filePath?: string
  line?: number
  recommendation?: string
  status: ReviewIssueStatus
  fixSessionId?: string
  createdAt: number
  updatedAt: number
  resolvedAt?: number
  roundNumber?: number
  providerRef?: string
  batchStatus?: 'pending' | 'fixing' | 'applied' | 'failed'
}

export interface ReviewIssueListFilter {
  projectId: string
  status?: ReviewIssueStatus | 'active' | 'all'
  sessionId?: string
  threadId?: string
  specRunId?: string
  roundNumber?: number
  provider?: ReviewIssueProvider | 'all'
  prNumber?: number
}

export interface ReviewIssueStatusCounts {
  open: number
  fixing: number
  resolved: number
  ignored: number
}

export interface ExtensionReviewProviderRegistration {
  installationId: string
  extensionId: string
  providers: string[]
  stderr?: string
}

export interface ReviewIssueSnapshot {
  issues: ReviewIssue[]
  counts: ReviewIssueStatusCounts
}

export interface ReviewIssuePatch {
  status?: ReviewIssueStatus
  fixSessionId?: string | null
  roundNumber?: number
  providerRef?: string
  batchStatus?: 'pending' | 'fixing' | 'applied' | 'failed' | null
}

export interface ReviewRound {
  id: string
  projectId: string
  roundNumber: number
  status: 'active' | 'completed'
  createdAt: number
  completedAt?: number
}

export type FixBatchStatus = 'pending' | 'running' | 'applied' | 'failed'

export interface ReviewFixBatch {
  id: string
  projectId: string
  issueIds: string[]
  status: FixBatchStatus
  sessionId?: string
  createdAt: number
  completedAt?: number
}
