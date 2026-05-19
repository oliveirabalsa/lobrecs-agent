import { ipcMain } from 'electron'
import type { MainIpcContext } from '../../shared/ipcContext'
import { requireProject } from '../../projects/application/requireProject'
import { GitCommitWorkflowService } from '../application/gitCommitWorkflowService'
import { runGit } from '../infrastructure/runGit'
import type {
  GitCommitInput,
  GitDiffRequest,
  GitFileSelection,
  GitCommitPlanExecutionInput,
} from '../../../../shared/types'

export function registerGitHandlers(context: MainIpcContext): void {
  const workflowService = new GitCommitWorkflowService(context)

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

  ipcMain.handle('git:analyze-commit-plan', async (_event, projectId: string) =>
    workflowService.analyzeCommitPlan(projectId),
  )

  ipcMain.handle(
    'git:execute-commit-plan',
    async (_event, input: GitCommitPlanExecutionInput) =>
      workflowService.executeCommitPlan(input),
  )
}
