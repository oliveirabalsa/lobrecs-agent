import type { ReviewIssue } from '../../../../shared/contracts/reviews'

export interface ReviewProviderAdapter {
  fetchIssues(projectId: string, repoPath: string): Promise<ReviewIssue[]>
}
