import type { AgentModelCatalog } from '../../shared/contracts/agents'
import type { SelectedDirectoryPath } from '../../shared/contracts/system'
import type { IpcInvoker } from './ipc'

export interface SystemApi {
  openInEditor(filePath: string): Promise<void>
  selectDirectory(): Promise<SelectedDirectoryPath>
  checkAgentInstalled(agentId: string): Promise<boolean>
  listAgentModels(): Promise<AgentModelCatalog[]>
}

export function createSystemApi(ipcRenderer: IpcInvoker): SystemApi {
  return {
    openInEditor: (filePath) => ipcRenderer.invoke('system:open-editor', filePath),
    selectDirectory: () => ipcRenderer.invoke('system:select-directory'),
    checkAgentInstalled: (agentId) => ipcRenderer.invoke('system:check-agent', agentId),
    listAgentModels: () => ipcRenderer.invoke('system:list-agent-models'),
  }
}
