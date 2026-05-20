import type {
  RepositoryContextChunk,
  RepositoryContextIndexResult,
  RepositoryContextSearchParams,
  RepositoryContextStatus,
} from '../../shared/contracts/context'
import type { IpcInvoker } from './ipc'

export interface RepositoryContextApi {
  index(projectId: string): Promise<RepositoryContextIndexResult>
  status(projectId: string): Promise<RepositoryContextStatus>
  search(params: RepositoryContextSearchParams): Promise<RepositoryContextChunk[]>
}

export function createRepositoryContextApi(ipcRenderer: IpcInvoker): RepositoryContextApi {
  return {
    index: (projectId) => ipcRenderer.invoke('context:index', projectId),
    status: (projectId) => ipcRenderer.invoke('context:status', projectId),
    search: (params) => ipcRenderer.invoke('context:search', params),
  }
}
