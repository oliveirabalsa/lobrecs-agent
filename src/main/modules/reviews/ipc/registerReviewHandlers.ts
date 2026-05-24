import { ipcMain } from 'electron'
import { reviewIssuesStore } from '../../../store'
import type { ReviewIssueListFilter, ReviewIssuePatch } from '../../../../shared/types'

export function registerReviewHandlers(): void {
  ipcMain.handle('reviews:list', async (_event, filter: ReviewIssueListFilter) => {
    assertProjectFilter(filter)
    return reviewIssuesStore.list(filter)
  })

  ipcMain.handle('reviews:update', async (_event, issueId: string, patch: ReviewIssuePatch) => {
    assertIssueId(issueId)
    assertPatch(patch)
    return reviewIssuesStore.update(issueId, patch)
  })
}

function assertProjectFilter(filter: ReviewIssueListFilter): void {
  if (!filter || typeof filter.projectId !== 'string' || filter.projectId.trim().length === 0) {
    throw new Error('projectId is required')
  }
}

function assertIssueId(issueId: string): void {
  if (typeof issueId !== 'string' || issueId.trim().length === 0) {
    throw new Error('review issue id is required')
  }
}

function assertPatch(patch: ReviewIssuePatch): void {
  if (!patch || typeof patch !== 'object') {
    throw new Error('review issue update is required')
  }

  if (
    patch.status !== undefined &&
    patch.status !== 'open' &&
    patch.status !== 'fixing' &&
    patch.status !== 'resolved' &&
    patch.status !== 'ignored'
  ) {
    throw new Error('invalid review issue status')
  }

  if (
    patch.fixSessionId !== undefined &&
    patch.fixSessionId !== null &&
    typeof patch.fixSessionId !== 'string'
  ) {
    throw new Error('invalid fix session id')
  }
}
