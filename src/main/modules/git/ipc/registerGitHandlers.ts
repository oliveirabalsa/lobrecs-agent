import { ipcMain } from 'electron'
import type { MainIpcContext } from '../../shared/ipcContext'
import { requireProject } from '../../projects/application/requireProject'
import { GitCommitWorkflowService } from '../application/gitCommitWorkflowService'
import { buildGitGraphData } from '../application/gitGraphService'
import { PullRequestWorkflowService } from '../application/pullRequestWorkflowService'
import { pushCurrentBranch } from '../infrastructure/pushCurrentBranch'
import { runGit } from '../infrastructure/runGit'
import { reviewIssuesStore } from '../../../store'
import type {
  GitCommitInput,
  GitDiffRequest,
  GitFileSelection,
  GitCommitPlanExecutionInput,
  GitGraphRequest,
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
    const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], project.repoPath)
    if (branch.exitCode !== 0) return branch

    return pushCurrentBranch(project.repoPath, branch.stdout.trim())
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

  ipcMain.handle('git:review-current-diff', async (_event, projectId: string, threadId?: string) => {
    const result = await workflowService.reviewCurrentDiff(projectId, threadId)
    reviewIssuesStore.saveDiffReviewIssues({ result, threadId })
    return result
  })

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

  ipcMain.handle('git:create-branch', async (_event, projectId: string, branchName: string) => {
    const project = requireProject(projectId)
    const name = await validateBranchName(branchName, project.repoPath)
    return runGit(['switch', '-c', name], project.repoPath)
  })

  ipcMain.handle('git:checkout-branch', async (_event, projectId: string, branchName: string) => {
    const project = requireProject(projectId)
    const name = await validateBranchName(branchName, project.repoPath)
    return runGit(['switch', name], project.repoPath)
  })

  ipcMain.handle('git:list-branches', async (_event, projectId: string) => {
    const project = requireProject(projectId)
    const result = await runGit(['branch', '--format=%(refname:short)'], project.repoPath)
    if (result.exitCode !== 0) return []
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  })

  ipcMain.handle('git:pull', async (_event, projectId: string) => {
    const project = requireProject(projectId)
    return runGit(['pull'], project.repoPath)
  })

  ipcMain.handle('git:fetch', async (_event, projectId: string) => {
    const project = requireProject(projectId)
    return runGit(['fetch'], project.repoPath)
  })

  ipcMain.handle('git:get-graph-data', async (_event, request: GitGraphRequest) => {
    const project = requireProject(request.projectId)
    return buildGitGraphData(request.projectId, project.repoPath, context.worktreeManager)
  })
}

async function validateBranchName(branchName: string, repoPath: string): Promise<string> {
  const name = branchName.trim()
  if (!name) {
    throw new Error('Branch name is required.')
  }

  const result = await runGit(['check-ref-format', '--branch', name], repoPath)
  if (result.exitCode === 0) return name

  throw new Error(result.stderr.trim() || result.stdout.trim() || 'Invalid branch name.')
}
