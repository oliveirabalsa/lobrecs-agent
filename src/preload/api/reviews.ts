import type {
  ReviewIssue,
  ExtensionReviewProviderRegistration,
  ReviewIssueListFilter,
  ReviewIssuePatch,
  ReviewIssueProvider,
  ReviewIssueSnapshot,
} from '../../shared/contracts/reviews'
import type { IpcInvoker } from './ipc'

export interface ReviewsApi {
  list(filter: ReviewIssueListFilter): Promise<ReviewIssueSnapshot>
  update(issueId: string, patch: ReviewIssuePatch): Promise<ReviewIssue>
  fetch(projectId: string, provider: ReviewIssueProvider): Promise<ReviewIssue[]>
  listProviders(projectId: string): Promise<ExtensionReviewProviderRegistration[]>
  createRound(projectId: string): Promise<number>
  fixBatch(projectId: string, issueIds: string[], threadId?: string): Promise<{ sessionId: string; threadId: string }>
}

export function createReviewsApi(ipcRenderer: IpcInvoker): ReviewsApi {
  return {
    list: (filter) => ipcRenderer.invoke('reviews:list', filter),
    update: (issueId, patch) => ipcRenderer.invoke('reviews:update', issueId, patch),
    fetch: (projectId, provider) => ipcRenderer.invoke('reviews:fetch', projectId, provider),
    listProviders: (projectId) => ipcRenderer.invoke('reviews:list-providers', projectId),
    createRound: (projectId) => ipcRenderer.invoke('reviews:create-round', projectId),
    fixBatch: (projectId, issueIds, threadId) => ipcRenderer.invoke('reviews:fix-batch', projectId, issueIds, threadId),
  }
}
