import { spawn } from 'node:child_process'
import { ipcMain } from 'electron'
import { projectsStore } from '../../../store'
import type {
  GitCommandResult,
  GitCommitInput,
  GitDiffRequest,
  GitFileSelection,
} from '../../../../shared/types'

export function registerGitHandlers(): void {
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
}

function requireProject(projectId: string) {
  const project = projectsStore.get(projectId)
  if (!project) {
    throw new Error(`Project not found: ${projectId}`)
  }

  return project
}

function runGit(args: string[], cwd: string): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      resolve({ exitCode: 1, stdout, stderr: error.message })
    })
    child.on('exit', (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr })
    })
  })
}
