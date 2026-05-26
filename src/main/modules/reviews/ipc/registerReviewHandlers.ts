import { ipcMain } from 'electron'
import { reviewIssuesStore, projectsStore } from '../../../store'
import type { ReviewIssueListFilter, ReviewIssuePatch, ReviewIssueProvider } from '../../../../shared/types'
import type { MainIpcContext } from '../../shared/ipcContext'
import { GitHubProviderAdapter } from '../infrastructure/githubProvider'
import { requireProject } from '../../projects/application/requireProject'
import { capacityFallbackModelsForAgent } from '../../../router/modelCapacityFallbacks'
import { runtimeSettingsWithApprovalMode } from '../../agents/domain/approvalMode'

export function registerReviewHandlers(context: MainIpcContext): void {
  ipcMain.handle('reviews:list', async (_event, filter: ReviewIssueListFilter) => {
    assertProjectFilter(filter)
    return reviewIssuesStore.list(filter)
  })

  ipcMain.handle('reviews:update', async (_event, issueId: string, patch: ReviewIssuePatch) => {
    assertIssueId(issueId)
    assertPatch(patch)
    return reviewIssuesStore.update(issueId, patch)
  })

  ipcMain.handle('reviews:list-providers', async (_event, projectId: string) => {
    const project = requireProject(projectId)
    return context.extensionMarketplaceService.listReviewProviders({
      projectPath: project.repoPath,
    })
  })

  ipcMain.handle('reviews:fetch', async (_event, projectId: string, provider: ReviewIssueProvider) => {
    const project = requireProject(projectId)
    if (provider === 'github') {
      const adapter = new GitHubProviderAdapter()
      const issues = await adapter.fetchIssues(projectId, project.repoPath)

      // Determine next round number
      const snapshot = reviewIssuesStore.list({ projectId })
      const maxRound = snapshot.issues.reduce((max, issue) => Math.max(max, issue.roundNumber ?? 0), 0)
      const nextRound = maxRound + 1

      // Set round number
      const mappedIssues = issues.map((issue) => ({
        ...issue,
        roundNumber: nextRound,
      }))

      // Save/upsert to database
      return reviewIssuesStore.upsertIssues(projectId, mappedIssues)
    } else if (provider === 'coderabbit') {
      throw new Error('CodeRabbit provider is not implemented yet.')
    } else {
      throw new Error(`Unsupported review provider: ${provider}`)
    }
  })

  ipcMain.handle('reviews:create-round', async (_event, projectId: string) => {
    const snapshot = reviewIssuesStore.list({ projectId })
    const maxRound = snapshot.issues.reduce((max, issue) => Math.max(max, issue.roundNumber ?? 0), 0)
    return maxRound + 1
  })

  ipcMain.handle('reviews:fix-batch', async (_event, projectId: string, issueIds: string[], threadId?: string) => {
    if (!Array.isArray(issueIds) || issueIds.length === 0) {
      throw new Error('No issues provided for batch fixing')
    }

    const project = requireProject(projectId)
    const snapshot = reviewIssuesStore.list({ projectId })
    const targetIssues = snapshot.issues.filter((issue) => issueIds.includes(issue.id))

    if (targetIssues.length === 0) {
      throw new Error('No valid review issues found for matching IDs')
    }

    // Build consolidated prompt
    const promptParts = [
      'Fix the following review issues in a single batch:',
      '',
    ]
    for (let i = 0; i < targetIssues.length; i++) {
      const issue = targetIssues[i]
      promptParts.push(`---`)
      promptParts.push(`Issue ${i + 1}: ${issue.title}`)
      if (issue.filePath) {
        promptParts.push(`File: ${issue.filePath}${issue.line ? `:${issue.line}` : ''}`)
      }
      promptParts.push(`Severity: ${issue.severity}`)
      promptParts.push(`Category: ${issue.category}`)
      promptParts.push(`Detail: ${issue.detail}`)
      if (issue.recommendation) {
        promptParts.push(`Recommendation: ${issue.recommendation}`)
      }
      promptParts.push('')
    }
    const prompt = promptParts.join('\n')

    const settings = context.settingsService.getEffective(project.id).settings
    const preferredAgentId = settings.agents.defaultAgentId

    const decision = await context.modelRouter.route({
      prompt,
      preferredAgentId,
      projectId: project.id,
      autoAgentSelection: true,
    })

    const runtimeSettings = runtimeSettingsWithApprovalMode(
      settings.agents.runtimes[decision.agentId],
      undefined,
      settings.execution.defaultApprovalMode,
    )

    const { sessionId, threadId: runThreadId } = await context.sessionManager.dispatch({
      projectId: project.id,
      prompt,
      agentId: decision.agentId,
      model: decision.model,
      modelFallbacks: capacityFallbackModelsForAgent({
        settings,
        agentId: decision.agentId,
        currentModel: decision.model,
      }),
      repoPath: project.repoPath,
      context: projectsStore.getContext(project.id),
      threadId: threadId || undefined,
      isolate: settings.execution.worktreeIsolation,
      runtimeSettings,
      returnAfterSessionCreated: true,
    })

    // Update issues to fixing
    for (const issue of targetIssues) {
      reviewIssuesStore.update(issue.id, {
        status: 'fixing',
        fixSessionId: sessionId,
        batchStatus: 'fixing',
      })
    }

    return { sessionId, threadId: runThreadId }
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
