import { ipcMain } from 'electron'
import type {
  CreateProjectKnowledgeInput,
  DeleteProjectKnowledgeInput,
} from '../../../../shared/contracts/memory'
import type { MainIpcContext } from '../../shared/ipcContext'

export function registerMemoryHandlers(context: MainIpcContext): void {
  ipcMain.handle('memory:list', async (_event, projectId: string) =>
    context.projectMemoryService.list(projectId),
  )
  ipcMain.handle('memory:save', async (_event, input: CreateProjectKnowledgeInput) =>
    context.projectMemoryService.save(input),
  )
  ipcMain.handle('memory:delete', async (_event, input: DeleteProjectKnowledgeInput) => {
    await context.projectMemoryService.delete(input.projectId, input.entryId)
  })
}
