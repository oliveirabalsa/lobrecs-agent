import { ipcMain } from 'electron'
import type { AppSettingsPatch } from '../../../../shared/types'
import type { MainIpcContext } from '../../shared/ipcContext'

export function registerSettingsHandlers(context: MainIpcContext): void {
  ipcMain.handle('settings:get-global', async () => context.settingsService.getGlobal())
  ipcMain.handle('settings:update-global', async (_event, input: AppSettingsPatch) =>
    context.settingsService.updateGlobal(input),
  )
  ipcMain.handle('settings:get-effective', async (_event, projectId?: string) =>
    context.settingsService.getEffective(projectId),
  )
  ipcMain.handle('settings:get-project-overrides', async (_event, projectId: string) =>
    context.settingsService.getProjectOverrides(projectId),
  )
  ipcMain.handle(
    'settings:update-project-overrides',
    async (_event, projectId: string, input: AppSettingsPatch) =>
      context.settingsService.updateProjectOverrides(projectId, input),
  )
  ipcMain.handle('settings:reset-project-overrides', async (_event, projectId: string) => {
    context.settingsService.resetProjectOverrides(projectId)
  })
}
