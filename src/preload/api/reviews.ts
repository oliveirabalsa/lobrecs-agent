import type {
  ReviewIssue,
  ReviewIssueListFilter,
  ReviewIssuePatch,
  ReviewIssueSnapshot,
} from '../../shared/contracts/reviews'
import type { IpcInvoker } from './ipc'

export interface ReviewsApi {
  list(filter: ReviewIssueListFilter): Promise<ReviewIssueSnapshot>
  update(issueId: string, patch: ReviewIssuePatch): Promise<ReviewIssue>
}

export function createReviewsApi(ipcRenderer: IpcInvoker): ReviewsApi {
  return {
    list: (filter) => ipcRenderer.invoke('reviews:list', filter),
    update: (issueId, patch) => ipcRenderer.invoke('reviews:update', issueId, patch),
  }
}
