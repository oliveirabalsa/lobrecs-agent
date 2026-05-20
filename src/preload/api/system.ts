import type { IpcRendererEvent } from 'electron'
import type { AgentModelCatalog } from '../../shared/contracts/agents'
import type {
  AdapterCapability,
  CliEditorTerminalDataEvent,
  CliEditorTerminalExitEvent,
  CliEditorTerminalResizeInput,
  CliEditorTerminalSession,
  CliEditorTerminalStartInput,
  CliEditorTerminalWriteInput,
  EditorInfo,
  ImageAttachment,
  MarkdownDocument,
  OpenInEditorInput,
  ReadMarkdownDocumentInput,
  SaveImageAttachmentInput,
  SelectedDirectoryPath,
  VerificationRecipe,
} from '../../shared/contracts/system'
import type { IpcInvoker, IpcSubscriber } from './ipc'

export interface SystemApi {
  openInEditor(filePath: string): Promise<void>
  readMarkdownDocument(input: ReadMarkdownDocumentInput): Promise<MarkdownDocument>
  selectDirectory(): Promise<SelectedDirectoryPath>
  checkAgentInstalled(agentId: string): Promise<boolean>
  listAgentModels(): Promise<AgentModelCatalog[]>
  listCapabilities(): Promise<AdapterCapability[]>
  listVerificationRecipes(projectId?: string): Promise<VerificationRecipe[]>
  saveImageAttachment(input: SaveImageAttachmentInput): Promise<ImageAttachment>
  listEditors(): Promise<EditorInfo[]>
  openProjectIn(input: OpenInEditorInput): Promise<void>
  startCliEditorTerminal(input: CliEditorTerminalStartInput): Promise<CliEditorTerminalSession>
  writeCliEditorTerminal(input: CliEditorTerminalWriteInput): Promise<void>
  resizeCliEditorTerminal(input: CliEditorTerminalResizeInput): Promise<void>
  stopCliEditorTerminal(sessionId: string): Promise<void>
  onCliEditorTerminalData(callback: (event: CliEditorTerminalDataEvent) => void): () => void
  onCliEditorTerminalExit(callback: (event: CliEditorTerminalExitEvent) => void): () => void
}

export function createSystemApi(ipcRenderer: IpcInvoker & IpcSubscriber): SystemApi {
  return {
    openInEditor: (filePath) => ipcRenderer.invoke('system:open-editor', filePath),
    readMarkdownDocument: (input) =>
      ipcRenderer.invoke('system:read-markdown-document', input),
    selectDirectory: () => ipcRenderer.invoke('system:select-directory'),
    checkAgentInstalled: (agentId) => ipcRenderer.invoke('system:check-agent', agentId),
    listAgentModels: () => ipcRenderer.invoke('system:list-agent-models'),
    listCapabilities: () => ipcRenderer.invoke('system:list-capabilities'),
    listVerificationRecipes: (projectId) =>
      ipcRenderer.invoke('system:list-verification-recipes', projectId),
    saveImageAttachment: (input) => ipcRenderer.invoke('system:save-image-attachment', input),
    listEditors: () => ipcRenderer.invoke('system:list-editors'),
    openProjectIn: (input) => ipcRenderer.invoke('system:open-in-editor', input),
    startCliEditorTerminal: (input) =>
      ipcRenderer.invoke('system:start-cli-editor-terminal', input),
    writeCliEditorTerminal: (input) =>
      ipcRenderer.invoke('system:write-cli-editor-terminal', input),
    resizeCliEditorTerminal: (input) =>
      ipcRenderer.invoke('system:resize-cli-editor-terminal', input),
    stopCliEditorTerminal: (sessionId) =>
      ipcRenderer.invoke('system:stop-cli-editor-terminal', sessionId),
    onCliEditorTerminalData: (callback) => {
      const handler = (_event: IpcRendererEvent, payload: CliEditorTerminalDataEvent) =>
        callback(payload)
      ipcRenderer.on('system:cli-editor-terminal:data', handler)
      return () => ipcRenderer.removeListener('system:cli-editor-terminal:data', handler)
    },
    onCliEditorTerminalExit: (callback) => {
      const handler = (_event: IpcRendererEvent, payload: CliEditorTerminalExitEvent) =>
        callback(payload)
      ipcRenderer.on('system:cli-editor-terminal:exit', handler)
      return () => ipcRenderer.removeListener('system:cli-editor-terminal:exit', handler)
    },
  }
}
