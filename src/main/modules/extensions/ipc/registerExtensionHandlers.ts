import { ipcMain } from 'electron'
import type { InstallExtensionInput, SearchMarketplaceExtensionsInput } from '../../../../shared/types'
import type { ExtensionMarketplaceService } from '../application/extensionMarketplaceService'

export function registerExtensionHandlers(service: ExtensionMarketplaceService): void {
  ipcMain.handle('extensions:get-state', async () => service.getState())
  ipcMain.handle('extensions:list-catalog', async () => service.listCatalog())
  ipcMain.handle('extensions:search-catalog', async (_event, input: SearchMarketplaceExtensionsInput) =>
    service.searchCatalog(input),
  )
  ipcMain.handle('extensions:list-installed', async () => service.listInstalled())
  ipcMain.handle('extensions:install', async (_event, input: InstallExtensionInput) =>
    service.install(input),
  )
}
