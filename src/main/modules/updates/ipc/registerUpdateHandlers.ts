import { ipcMain } from 'electron'
import type { AppUpdateService } from '../application/appUpdateService'
import { appUpdateService } from '../application/appUpdateService'

export function registerUpdateHandlers(service: AppUpdateService = appUpdateService): void {
  ipcMain.handle('updates:get-state', async () => service.getState())
  ipcMain.handle('updates:check', async () => service.checkForUpdates())
  ipcMain.handle('updates:download', async () => service.downloadUpdate())
  ipcMain.handle('updates:install-and-restart', async () => {
    await service.installDownloadedUpdate()
  })
  ipcMain.handle('updates:open-release-url', async () => service.openReleaseUrl())
}
