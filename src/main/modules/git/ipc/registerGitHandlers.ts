import { ipcMain, shell } from 'electron'
import { watch, FSWatcher } from 'node:fs'
import { promises as fsPromises } from 'node:fs'
import * as path from 'node:path'
import { getMainWindow } from '../../../app/bootstrap'
import type { MainIpcContext } from '../../shared/ipcContext'
import { requireProject } from '../../projects/application/requireProject'
import { GitCommitWorkflowService } from '../application/gitCommitWorkflowService'
import { GitWorkspaceService, validateBranchName } from '../application/gitWorkspaceService'
import { PullRequestWorkflowService } from '../application/pullRequestWorkflowService'
import { runGit } from '../infrastructure/runGit'
import { reviewIssuesStore } from '../../../store'
import type {
  GitBranchActionInput,
  GitCommitInput,
  GitCommitDetailRequest,
  GitDiffRequest,
  GitFileActionInput,
  GitFileDiffRequest,
  GitFileSelection,
  GitCommitPlanExecutionInput,
  GitSnapshotRequest,
  GitStashActionInput,
  GitStashDetailRequest,
  CreatePullRequestInput,
  CreatePullRequestFromDraftInput,
  GeneratePullRequestDraftInput,
  ReviewPullRequestInput,
  SyncPullRequestReviewInput,
  BringThreadToLocalInput,
  CreateBranchHereInput,
  MoveThreadToWorktreeInput,
  WorktreeHandoffRequest,
} from '../../../../shared/types'

export function registerGitHandlers(context: MainIpcContext): void {
  const workflowService = new GitCommitWorkflowService(context)
  const prWorkflowService = new PullRequestWorkflowService(context)
  const gitWorkspaceService = new GitWorkspaceService()

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
    return gitWorkspaceService.commit(project.repoPath, input)
  })

  ipcMain.handle('git:push', async (_event, projectId: string) => {
    const project = requireProject(projectId)
    return gitWorkspaceService.push(project.repoPath)
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
    return workflowService.reviewCurrentDiff(projectId, threadId)
  })

  ipcMain.handle('git:get-fingerprint', async (_event, projectId: string) => {
    return workflowService.getWorkingTreeFingerprint(projectId)
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
    startWatchingProject(projectId, project.repoPath).catch((err) => {
      console.error('[git] failed to watch project git dir', err)
    })
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

  ipcMain.handle('git:review-pr', async (_event, input: ReviewPullRequestInput) => {
    assertReviewPullRequestInput(input)
    return prWorkflowService.reviewPullRequest(input)
  })

  ipcMain.handle('git:sync-pr-review', async (_event, input: SyncPullRequestReviewInput) => {
    assertReviewPullRequestInput(input)
    return prWorkflowService.syncPrReview(input)
  })

  ipcMain.handle('git:create-branch', async (_event, projectId: string, branchName: string) => {
    const project = requireProject(projectId)
    const name = await validateBranchName(branchName, project.repoPath)
    return runGit(['switch', '-c', name], project.repoPath)
  })

  ipcMain.handle('git:checkout-branch', async (_event, projectId: string, branchName: string) => {
    const project = requireProject(projectId)
    return gitWorkspaceService.checkoutBranch(project.repoPath, {
      projectId,
      branchName,
    })
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
    return gitWorkspaceService.pull(project.repoPath)
  })

  ipcMain.handle('git:fetch', async (_event, projectId: string) => {
    const project = requireProject(projectId)
    return gitWorkspaceService.fetch(project.repoPath)
  })

  ipcMain.handle('git:get-snapshot', async (_event, request: GitSnapshotRequest) => {
    const project = requireProject(request.projectId)
    return gitWorkspaceService.getSnapshot(project.repoPath, request)
  })

  ipcMain.handle('git:get-file-diff', async (_event, request: GitFileDiffRequest) => {
    const project = requireProject(request.projectId)
    return gitWorkspaceService.getFileDiff(project.repoPath, request)
  })

  ipcMain.handle('git:get-worktree-handoff-state', async (_event, request: WorktreeHandoffRequest) => {
    ensureWorktreeHandoffEnabled(context, request.projectId)
    const project = requireProject(request.projectId)
    return context.sessionManager.getWorktreeHandoffState(request, project.repoPath)
  })

  ipcMain.handle('git:preview-worktree-handoff', async (_event, request: WorktreeHandoffRequest) => {
    ensureWorktreeHandoffEnabled(context, request.projectId)
    const project = requireProject(request.projectId)
    return context.sessionManager.previewWorktreeHandoff(request, project.repoPath)
  })

  ipcMain.handle('git:move-thread-to-worktree', async (_event, input: MoveThreadToWorktreeInput) => {
    ensureWorktreeHandoffEnabled(context, input.projectId)
    const project = requireProject(input.projectId)
    return context.sessionManager.moveThreadToWorktree(input, project.repoPath)
  })

  ipcMain.handle('git:bring-thread-to-local', async (_event, input: BringThreadToLocalInput) => {
    ensureWorktreeHandoffEnabled(context, input.projectId)
    const project = requireProject(input.projectId)
    return context.sessionManager.bringThreadToLocal(input, project.repoPath)
  })

  ipcMain.handle('git:create-branch-here', async (_event, input: CreateBranchHereInput) => {
    ensureWorktreeHandoffEnabled(context, input.projectId)
    const project = requireProject(input.projectId)
    return context.sessionManager.createBranchHere(input, project.repoPath)
  })

  ipcMain.handle('git:restore-worktree-snapshot', async (_event, request: WorktreeHandoffRequest) => {
    ensureWorktreeHandoffEnabled(context, request.projectId)
    const project = requireProject(request.projectId)
    return context.sessionManager.restoreWorktreeSnapshot(request, project.repoPath)
  })

  ipcMain.handle('git:open-worktree', async (_event, request: WorktreeHandoffRequest) => {
    ensureWorktreeHandoffEnabled(context, request.projectId)
    const metadata = context.worktreeManager.getThreadWorktree(request.threadId)
    if (!metadata?.worktreePath) {
      throw new Error('This thread is not attached to a worktree.')
    }

    const error = await shell.openPath(metadata.worktreePath)
    if (error) throw new Error(error)
    return context.sessionManager.getWorktreeHandoffState(
      request,
      requireProject(request.projectId).repoPath,
    )
  })

  ipcMain.handle('git:get-commit-detail', async (_event, request: GitCommitDetailRequest) => {
    const project = requireProject(request.projectId)
    return gitWorkspaceService.getCommitDetail(project.repoPath, request)
  })

  ipcMain.handle('git:get-stash-detail', async (_event, request: GitStashDetailRequest) => {
    const project = requireProject(request.projectId)
    return gitWorkspaceService.getStashDetail(project.repoPath, request)
  })

  ipcMain.handle('git:stage-file', async (_event, input: GitFileActionInput) => {
    const project = requireProject(input.projectId)
    return gitWorkspaceService.stageFile(project.repoPath, input)
  })

  ipcMain.handle('git:unstage-file', async (_event, input: GitFileActionInput) => {
    const project = requireProject(input.projectId)
    return gitWorkspaceService.unstageFile(project.repoPath, input)
  })

  ipcMain.handle('git:stage-all', async (_event, projectId: string) => {
    const project = requireProject(projectId)
    return gitWorkspaceService.stageAll(project.repoPath)
  })

  ipcMain.handle('git:unstage-all', async (_event, projectId: string) => {
    const project = requireProject(projectId)
    return gitWorkspaceService.unstageAll(project.repoPath)
  })

  ipcMain.handle('git:delete-branch', async (_event, input: GitBranchActionInput) => {
    const project = requireProject(input.projectId)
    return gitWorkspaceService.deleteBranch(project.repoPath, input)
  })

  ipcMain.handle('git:discard-file', async (_event, input: GitFileActionInput) => {
    const project = requireProject(input.projectId)
    return gitWorkspaceService.discardFile(project.repoPath, input)
  })

  ipcMain.handle('git:checkout-branch-action', async (_event, input: GitBranchActionInput) => {
    const project = requireProject(input.projectId)
    return gitWorkspaceService.checkoutBranch(project.repoPath, input)
  })

  ipcMain.handle('git:apply-stash', async (_event, input: GitStashActionInput) => {
    const project = requireProject(input.projectId)
    return gitWorkspaceService.applyStash(project.repoPath, input)
  })

  ipcMain.handle('git:pop-stash', async (_event, input: GitStashActionInput) => {
    const project = requireProject(input.projectId)
    return gitWorkspaceService.popStash(project.repoPath, input)
  })

  ipcMain.handle('git:drop-stash', async (_event, input: GitStashActionInput) => {
    const project = requireProject(input.projectId)
    return gitWorkspaceService.dropStash(project.repoPath, input)
  })
}

function ensureWorktreeHandoffEnabled(context: MainIpcContext, projectId: string): void {
  const settings = context.settingsService.getEffective(projectId).settings
  if (!settings.execution.experimentalWorktreeHandoff) {
    throw new Error('Experimental worktree handoff is disabled in settings.')
  }
}

function assertReviewPullRequestInput(input: { projectId?: unknown; prNumber?: unknown }): void {
  if (!input || typeof input !== 'object') {
    throw new Error('Pull request review input is required.')
  }
  if (typeof input.projectId !== 'string' || input.projectId.trim().length === 0) {
    throw new Error('projectId is required.')
  }
  if (typeof input.prNumber !== 'number' || !Number.isInteger(input.prNumber) || input.prNumber <= 0) {
    throw new Error('A positive integer prNumber is required.')
  }
}

let activeProjectId: string | null = null
let activeWatcher: FSWatcher | null = null
let debounceTimeout: NodeJS.Timeout | null = null

async function resolveGitDir(repoPath: string): Promise<string | null> {
  const gitPath = path.join(repoPath, '.git')
  try {
    const stat = await fsPromises.stat(gitPath)
    if (stat.isDirectory()) {
      return gitPath
    } else if (stat.isFile()) {
      const content = await fsPromises.readFile(gitPath, 'utf8')
      const match = content.match(/^gitdir:\s*(.+)$/m)
      if (match) {
        const gitDir = match[1].trim()
        return path.isAbsolute(gitDir) ? gitDir : path.resolve(repoPath, gitDir)
      }
    }
  } catch (e) {
    // ignore
  }
  return null
}

async function startWatchingProject(projectId: string, repoPath: string) {
  if (activeProjectId === projectId) return

  if (activeWatcher) {
    activeWatcher.close()
    activeWatcher = null
  }
  if (debounceTimeout) {
    clearTimeout(debounceTimeout)
    debounceTimeout = null
  }

  activeProjectId = projectId

  try {
    const gitDir = await resolveGitDir(repoPath)
    if (!gitDir) return

    activeWatcher = watch(gitDir, (eventType, filename) => {
      if (filename === 'HEAD' || !filename) {
        if (debounceTimeout) clearTimeout(debounceTimeout)
        debounceTimeout = setTimeout(() => {
          const win = getMainWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send('git:branch-changed', { projectId })
          }
        }, 150)
      }
    })

    activeWatcher.on('error', () => {
      if (activeWatcher) {
        activeWatcher.close()
        activeWatcher = null
      }
      activeProjectId = null
    })
  } catch (e) {
    // Ignore watcher errors
  }
}
