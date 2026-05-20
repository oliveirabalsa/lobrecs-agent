import type {
  CreateProjectKnowledgeInput,
  DeleteProjectKnowledgeInput,
  ProjectKnowledgeEntry,
} from '../../shared/contracts/memory'
import type { IpcInvoker } from './ipc'

export interface MemoryApi {
  list(projectId: string): Promise<ProjectKnowledgeEntry[]>
  save(input: CreateProjectKnowledgeInput): Promise<ProjectKnowledgeEntry>
  delete(input: DeleteProjectKnowledgeInput): Promise<void>
}

export function createMemoryApi(ipcRenderer: IpcInvoker): MemoryApi {
  return {
    list: (projectId) => ipcRenderer.invoke('memory:list', projectId),
    save: (input) => ipcRenderer.invoke('memory:save', input),
    delete: (input) => ipcRenderer.invoke('memory:delete', input),
  }
}
