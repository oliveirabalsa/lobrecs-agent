import type { GitDiffReviewCategory, GitDiffReviewSeverity } from './git'

export type ReviewIssueProvider =
  | 'local-diff-review'
  | 'github'
  | 'coderabbit'
  | 'local-review'

export type ReviewIssueStatus = 'open' | 'fixing' | 'resolved' | 'ignored'

export type ReviewIssueSeverity = GitDiffReviewSeverity

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
}

export interface ReviewIssueListFilter {
  projectId: string
  status?: ReviewIssueStatus | 'active' | 'all'
  sessionId?: string
  threadId?: string
  specRunId?: string
}

export interface ReviewIssueStatusCounts {
  open: number
  fixing: number
  resolved: number
  ignored: number
}

export interface ReviewIssueSnapshot {
  issues: ReviewIssue[]
  counts: ReviewIssueStatusCounts
}

export interface ReviewIssuePatch {
  status?: ReviewIssueStatus
  fixSessionId?: string | null
}
