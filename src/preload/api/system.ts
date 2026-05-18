import type { AgentModelCatalog } from '../../shared/contracts/agents'
import type {
  AdapterCapability,
  ImageAttachment,
  SaveImageAttachmentInput,
  SelectedDirectoryPath,
  VerificationRecipe,
} from '../../shared/contracts/system'
import type { IpcInvoker } from './ipc'

export interface SystemApi {
  openInEditor(filePath: string): Promise<void>
  selectDirectory(): Promise<SelectedDirectoryPath>
  checkAgentInstalled(agentId: string): Promise<boolean>
  listAgentModels(): Promise<AgentModelCatalog[]>
  listCapabilities(): Promise<AdapterCapability[]>
  listVerificationRecipes(projectId?: string): Promise<VerificationRecipe[]>
  saveImageAttachment(input: SaveImageAttachmentInput): Promise<ImageAttachment>
}

export function createSystemApi(ipcRenderer: IpcInvoker): SystemApi {
  return {
    openInEditor: (filePath) => ipcRenderer.invoke('system:open-editor', filePath),
    selectDirectory: () => ipcRenderer.invoke('system:select-directory'),
    checkAgentInstalled: (agentId) => ipcRenderer.invoke('system:check-agent', agentId),
    listAgentModels: () => ipcRenderer.invoke('system:list-agent-models'),
    listCapabilities: () => ipcRenderer.invoke('system:list-capabilities'),
    listVerificationRecipes: (projectId) =>
      ipcRenderer.invoke('system:list-verification-recipes', projectId),
    saveImageAttachment: (input) => ipcRenderer.invoke('system:save-image-attachment', input),
  }
}
