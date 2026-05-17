import { ipcMain } from 'electron'
import { projectsStore } from '../../../store'
import type { Project } from '../../../../shared/types'

export function registerProjectHandlers(): void {
  ipcMain.handle('projects:list', async () => projectsStore.list())
  ipcMain.handle(
    'projects:create',
    async (_event, data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) =>
      projectsStore.create(data),
  )
  ipcMain.handle('projects:update', async (_event, id: string, data: Partial<Project>) =>
    projectsStore.update(id, data),
  )
  ipcMain.handle('projects:delete', async (_event, id: string) => {
    projectsStore.delete(id)
  })
}
