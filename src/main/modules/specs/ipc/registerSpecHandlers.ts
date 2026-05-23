import { ipcMain } from 'electron'
import { specsStore } from '../../../store'
import type { CreateSpecInput, UpdateSpecInput } from '../../../../shared/types'
import type { MainIpcContext } from '../../shared/ipcContext'
import { suggestSpecDraft } from '../application/draftSuggestAgent'

export function registerSpecHandlers(context: MainIpcContext): void {
  ipcMain.handle('specs:list', async (_event, projectId: string) => specsStore.list(projectId))
  ipcMain.handle('specs:get', async (_event, specId: string) => specsStore.get(specId))
  ipcMain.handle('specs:create', async (_event, data: CreateSpecInput) =>
    specsStore.create(data),
  )
  ipcMain.handle('specs:update', async (_event, specId: string, data: UpdateSpecInput) =>
    specsStore.update(specId, data),
  )
  ipcMain.handle('specs:approve', async (_event, specId: string) =>
    specsStore.approve(specId),
  )
  ipcMain.handle(
    'specs:draft-suggest',
    async (_event, { projectId, title, goal }: { projectId: string; title: string; goal: string }) =>
      suggestSpecDraft(context, projectId, title, goal),
  )
}

