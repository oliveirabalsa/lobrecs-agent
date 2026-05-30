import type {
  ExtensionMarketplaceState,
  InstallExtensionInput,
  InstalledExtensionRecord,
  MarketplaceCatalogSearchResult,
  MarketplaceExtension,
  RunExtensionDoctorInput,
  SearchMarketplaceExtensionsInput,
  UpdateExtensionRuntimeStateInput,
} from '../../shared/contracts/extensions'
import {
  validateInstallExtensionInput,
  validateRunExtensionDoctorInput,
  validateSearchMarketplaceExtensionsInput,
  validateUpdateExtensionRuntimeStateInput,
} from '../../shared/contracts/extensions'
import type { InstalledExtensionInventoryItem } from '../../shared/contracts/system'
import type { IpcInvoker } from './ipc'

export interface ExtensionsApi {
  getState(): Promise<ExtensionMarketplaceState>
  listCatalog(): Promise<MarketplaceExtension[]>
  searchCatalog(input?: SearchMarketplaceExtensionsInput): Promise<MarketplaceCatalogSearchResult>
  listInstalled(): Promise<InstalledExtensionRecord[]>
  install(input: InstallExtensionInput): Promise<InstalledExtensionRecord>
  updateRuntimeState(input: UpdateExtensionRuntimeStateInput): Promise<InstalledExtensionRecord>
  runDoctor(input: RunExtensionDoctorInput): Promise<InstalledExtensionRecord>
  listInstalledInventory(projectId?: string): Promise<InstalledExtensionInventoryItem[]>
}

export function createExtensionsApi(ipcRenderer: IpcInvoker): ExtensionsApi {
  return {
    getState: () => ipcRenderer.invoke('extensions:get-state'),
    listCatalog: () => ipcRenderer.invoke('extensions:list-catalog'),
    searchCatalog: (input) =>
      ipcRenderer.invoke('extensions:search-catalog', validateSearchMarketplaceExtensionsInput(input)),
    listInstalled: () => ipcRenderer.invoke('extensions:list-installed'),
    install: (input) => ipcRenderer.invoke('extensions:install', validateInstallExtensionInput(input)),
    updateRuntimeState: (input) =>
      ipcRenderer.invoke(
        'extensions:update-runtime-state',
        validateUpdateExtensionRuntimeStateInput(input),
      ),
    runDoctor: (input) =>
      ipcRenderer.invoke('extensions:run-doctor', validateRunExtensionDoctorInput(input)),
    listInstalledInventory: (projectId) =>
      ipcRenderer.invoke('extensions:list-installed-inventory', projectId),
  }
}
