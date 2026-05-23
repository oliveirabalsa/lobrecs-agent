import { ipcMain } from 'electron'
import type { MainIpcContext } from '../../shared/ipcContext'
import { requireProject } from '../../projects/application/requireProject'
import { GitCommitWorkflowService } from '../application/gitCommitWorkflowService'
import { PullRequestWorkflowService } from '../application/pullRequestWorkflowService'
import { runGit } from '../infrastructure/runGit'
import type {
  GitCommitInput,
  GitDiffRequest,
  GitFileSelection,
  GitCommitPlanExecutionInput,
  CreatePullRequestInput,
  CreatePullRequestFromDraftInput,
  GeneratePullRequestDraftInput,
} from '../../../../shared/types'

export function registerGitHandlers(context: MainIpcContext): void {
  const workflowService = new GitCommitWorkflowService(context)
  const prWorkflowService = new PullRequestWorkflowService(context)

  ipcMain.handle('git:diff', async (_event, request: GitDiffRequest) => {
    const project = requireProject(request.projectId)
    const args =
      request.scope === 'staged'
        ? ['diff', '--cached']
        : request.scope === 'head'
          ? ['diff', 'HEAD']
          : ['diff']

    return runGit(args, project.repoPath)
  })

  ipcMain.handle('git:stage', async (_event, request: GitFileSelection) => {
    const project = requireProject(request.projectId)
    return runGit(['add', ...(request.paths?.length ? request.paths : ['--all'])], project.repoPath)
  })

  ipcMain.handle('git:revert', async (_event, request: GitFileSelection) => {
    const project = requireProject(request.projectId)
    if (!request.paths?.length) {
      throw new Error('Revert requires explicit file paths')
    }

    return runGit(['checkout', '--', ...request.paths], project.repoPath)
  })

  ipcMain.handle('git:commit', async (_event, input: GitCommitInput) => {
    const project = requireProject(input.projectId)
    return runGit(['commit', '-m', input.message], project.repoPath)
  })

  ipcMain.handle('git:push', async (_event, projectId: string) => {
    const project = requireProject(projectId)
    return runGit(['push'], project.repoPath)
  })

  ipcMain.handle('git:get-pending-changes', async (_event, projectId: string) => {
    const project = requireProject(projectId)
    const status = await runGit(['status', '--porcelain'], project.repoPath)
    const fileCount =
      status.exitCode === 0
        ? status.stdout.split(/\r?\n/).filter((line) => line.trim()).length
        : 0

    return {
      projectId,
      fileCount,
      hasChanges: fileCount > 0,
    }
  })

  ipcMain.handle('git:analyze-commit-plan', async (_event, projectId: string) =>
    workflowService.analyzeCommitPlan(projectId),
  )

  ipcMain.handle('git:review-current-diff', async (_event, projectId: string, threadId?: string) =>
    workflowService.reviewCurrentDiff(projectId, threadId),
  )

  ipcMain.handle(
    'git:execute-commit-plan',
    async (_event, input: GitCommitPlanExecutionInput) =>
      workflowService.executeCommitPlan(input),
  )

  ipcMain.handle('git:get-remote', async (_event, projectId: string) => {
    return prWorkflowService.getRemoteInfo(projectId)
  })

  ipcMain.handle('git:get-current-branch', async (_event, projectId: string) => {
    const project = requireProject(projectId)
    const result = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], project.repoPath)
    if (result.exitCode !== 0) return ' HEAD'
    return result.stdout.trim()
  })

  ipcMain.handle('git:get-pr-template', async (_event, projectId: string) => {
    return prWorkflowService.resolveTemplate(projectId)
  })

  ipcMain.handle('git:generate-pr-draft', async (_event, input: GeneratePullRequestDraftInput) => {
    return prWorkflowService.generatePrDraft(input)
  })

  ipcMain.handle('git:create-pr-from-draft', async (_event, input: CreatePullRequestFromDraftInput) => {
    return prWorkflowService.createPrFromDraft(input)
  })

  ipcMain.handle('git:create-pr', async (_event, input: CreatePullRequestInput) => {
    return prWorkflowService.createPullRequest(input.projectId, {
      title: input.title,
      body: input.body,
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
    })
  })
}
