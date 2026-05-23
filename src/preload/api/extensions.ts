import type {
  ExtensionMarketplaceState,
  InstallExtensionInput,
  InstalledExtensionRecord,
  MarketplaceCatalogSearchResult,
  MarketplaceExtension,
  SearchMarketplaceExtensionsInput,
} from '../../shared/contracts/extensions'
import type { IpcInvoker } from './ipc'

export interface ExtensionsApi {
  getState(): Promise<ExtensionMarketplaceState>
  listCatalog(): Promise<MarketplaceExtension[]>
  searchCatalog(input?: SearchMarketplaceExtensionsInput): Promise<MarketplaceCatalogSearchResult>
  listInstalled(): Promise<InstalledExtensionRecord[]>
  install(input: InstallExtensionInput): Promise<InstalledExtensionRecord>
}

export function createExtensionsApi(ipcRenderer: IpcInvoker): ExtensionsApi {
  return {
    getState: () => ipcRenderer.invoke('extensions:get-state'),
    listCatalog: () => ipcRenderer.invoke('extensions:list-catalog'),
    searchCatalog: (input) => ipcRenderer.invoke('extensions:search-catalog', input),
    listInstalled: () => ipcRenderer.invoke('extensions:list-installed'),
    install: (input) => ipcRenderer.invoke('extensions:install', input),
  }
}
