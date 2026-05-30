import { ipcMain } from 'electron'
import { projectsStore } from '../../../store'
import {
  validateInstallExtensionInput,
  validateRunExtensionDoctorInput,
  validateSearchMarketplaceExtensionsInput,
  validateUpdateExtensionRuntimeStateInput,
} from '../../../../shared/types'
import { assertKnownProjectRoot } from '../../system/application/trustedPaths'
import type { MainIpcContext } from '../../shared/ipcContext'
import { ExtensionInventoryService } from '../application/extensionInventoryService'

export function registerExtensionHandlers(context: MainIpcContext): void {
  const service = context.extensionMarketplaceService

  ipcMain.handle('extensions:get-state', async () => service.getState())
  ipcMain.handle('extensions:list-catalog', async () => service.listCatalog())
  ipcMain.handle('extensions:search-catalog', async (_event, input: unknown) =>
    service.searchCatalog(validateSearchMarketplaceExtensionsInput(input)),
  )
  ipcMain.handle('extensions:list-installed', async () => service.listInstalled())
  ipcMain.handle('extensions:install', async (_event, rawInput: unknown) => {
    const input = validateInstallExtensionInput(rawInput)
    const projectPath = input.projectPath
      ? assertKnownProjectRoot(input.projectPath, projectsStore.list())
      : undefined

    return service.install({ ...input, projectPath })
  })
  ipcMain.handle(
    'extensions:update-runtime-state',
    async (_event, input: unknown) =>
      service.updateRuntimeState(validateUpdateExtensionRuntimeStateInput(input)),
  )
  ipcMain.handle('extensions:run-doctor', async (_event, input: unknown) =>
    service.runDoctor(validateRunExtensionDoctorInput(input)),
  )
  ipcMain.handle('extensions:list-installed-inventory', async (_event, projectId?: string) => {
    return new ExtensionInventoryService(context).listInventory(projectId)
  })
}
