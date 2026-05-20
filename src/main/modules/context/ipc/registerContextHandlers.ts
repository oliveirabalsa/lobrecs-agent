import { ipcMain } from 'electron'
import type { RepositoryContextSearchParams } from '../../../../shared/types'
import { requireProject } from '../../projects/application/requireProject'
import type { MainIpcContext } from '../../shared/ipcContext'

export function registerContextHandlers(context: MainIpcContext): void {
  ipcMain.handle('context:index', async (_event, projectId: string) => {
    const project = requireProject(projectId)
    return context.repositoryContext.indexProject({
      projectId: project.id,
      repoPath: project.repoPath,
    })
  })

  ipcMain.handle('context:status', async (_event, projectId: string) => {
    const project = requireProject(projectId)
    return context.repositoryContext.status(project.id)
  })

  ipcMain.handle('context:search', async (_event, params: RepositoryContextSearchParams) => {
    const project = requireProject(params.projectId)
    return context.repositoryContext.search({
      projectId: project.id,
      repoPath: project.repoPath,
      query: params.query,
      limit: params.limit,
    })
  })
}
