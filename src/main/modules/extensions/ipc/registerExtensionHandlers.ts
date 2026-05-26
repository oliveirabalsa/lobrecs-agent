import { ipcMain } from 'electron'
import type {
  InstallExtensionInput,
  RunExtensionDoctorInput,
  SearchMarketplaceExtensionsInput,
  UpdateExtensionRuntimeStateInput,
} from '../../../../shared/types'
import type { MainIpcContext } from '../../shared/ipcContext'
import { ExtensionInventoryService } from '../application/extensionInventoryService'

export function registerExtensionHandlers(context: MainIpcContext): void {
  const service = context.extensionMarketplaceService

  ipcMain.handle('extensions:get-state', async () => service.getState())
  ipcMain.handle('extensions:list-catalog', async () => service.listCatalog())
  ipcMain.handle('extensions:search-catalog', async (_event, input: SearchMarketplaceExtensionsInput) =>
    service.searchCatalog(input),
  )
  ipcMain.handle('extensions:list-installed', async () => service.listInstalled())
  ipcMain.handle('extensions:install', async (_event, input: InstallExtensionInput) =>
    service.install(input),
  )
  ipcMain.handle(
    'extensions:update-runtime-state',
    async (_event, input: UpdateExtensionRuntimeStateInput) =>
      service.updateRuntimeState(assertRuntimeStateInput(input)),
  )
  ipcMain.handle('extensions:run-doctor', async (_event, input: RunExtensionDoctorInput) =>
    service.runDoctor(assertDoctorInput(input)),
  )
  ipcMain.handle('extensions:list-installed-inventory', async (_event, projectId?: string) => {
    return new ExtensionInventoryService(context).listInventory(projectId)
  })
}

function assertRuntimeStateInput(
  input: UpdateExtensionRuntimeStateInput,
): UpdateExtensionRuntimeStateInput {
  if (!input || typeof input.installationId !== 'string' || !input.installationId.trim()) {
    throw new Error('extension installation id is required')
  }
  if (input.trusted !== undefined && typeof input.trusted !== 'boolean') {
    throw new Error('trusted must be boolean')
  }
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw new Error('enabled must be boolean')
  }
  return input
}

function assertDoctorInput(input: RunExtensionDoctorInput): RunExtensionDoctorInput {
  if (!input || typeof input.installationId !== 'string' || !input.installationId.trim()) {
    throw new Error('extension installation id is required')
  }
  return input
}
