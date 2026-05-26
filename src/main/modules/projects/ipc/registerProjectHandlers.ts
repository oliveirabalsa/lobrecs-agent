import { ipcMain } from 'electron'
import { projectsStore } from '../../../store'
import {
  validateCreateProjectInput,
  validateProjectId,
  validateUpdateProjectInput,
} from '../../../../shared/types'

export function registerProjectHandlers(): void {
  ipcMain.handle('projects:list', async () => projectsStore.list())
  ipcMain.handle(
    'projects:create',
    async (_event, rawData: unknown) =>
      projectsStore.create(validateCreateProjectInput(rawData)),
  )
  ipcMain.handle('projects:update', async (_event, rawId: unknown, rawData: unknown) =>
    projectsStore.update(validateProjectId(rawId), validateUpdateProjectInput(rawData)),
  )
  ipcMain.handle('projects:delete', async (_event, rawId: unknown) => {
    const id = validateProjectId(rawId)
    projectsStore.delete(id)
  })
}
