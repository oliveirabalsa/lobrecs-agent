import type { IpcRendererEvent } from 'electron'
import type { AgentModelCatalog } from '../../shared/contracts/agents'
import type { AgentProfileDoctorReport } from '../../shared/contracts/agentProfiles'
import type {
  AdapterCapability,
  CliEditorTerminalDataEvent,
  CliEditorTerminalExitEvent,
  CliEditorTerminalResizeInput,
  CliEditorTerminalSession,
  CliEditorTerminalStartInput,
  CliEditorTerminalWriteInput,
  EditorInfo,
  DoctorReport,
  ImageAttachment,
  ImagePreviewSourceInput,
  ManagedCliActionResult,
  ManagedCliStatus,
  MarkdownDocument,
  OpenInEditorInput,
  ReadMarkdownDocumentInput,
  RunManagedCliActionInput,
  SaveAttachmentInput,
  SelectedDirectoryPath,
  VerificationRecipe,
} from '../../shared/contracts/system'
import {
  validateCliEditorTerminalResizeInput,
  validateCliEditorTerminalStartInput,
  validateCliEditorTerminalWriteInput,
  validateOpenEditorPath,
  validateOpenInEditorInput,
  validateReadMarkdownDocumentInput,
} from '../../shared/contracts/system'
import { assertPlainId } from '../../shared/contracts/validation'
import type { IpcInvoker, IpcSubscriber } from './ipc'

export interface SystemApi {
  openInEditor(filePath: string): Promise<void>
  readMarkdownDocument(input: ReadMarkdownDocumentInput): Promise<MarkdownDocument>
  selectDirectory(): Promise<SelectedDirectoryPath>
  selectBackgroundImage(): Promise<string | null>
  loadBackgroundImage(filePath: string): Promise<string | null>
  checkAgentInstalled(agentId: string): Promise<boolean>
  listAgentModels(): Promise<AgentModelCatalog[]>
  listCapabilities(): Promise<AdapterCapability[]>
  getAgentProfileDoctor(projectId: string): Promise<AgentProfileDoctorReport>
  runDoctor(projectId?: string): Promise<DoctorReport>
  listVerificationRecipes(projectId?: string): Promise<VerificationRecipe[]>
  listManagedCliRuntimes(): Promise<ManagedCliStatus[]>
  runManagedCliAction(input: RunManagedCliActionInput): Promise<ManagedCliActionResult>
  saveAttachment(input: SaveAttachmentInput): Promise<ImageAttachment>
  copyImageToClipboard(input: ImagePreviewSourceInput): Promise<void>
  saveImageFile(input: ImagePreviewSourceInput): Promise<string | null>
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
    openInEditor: (filePath) =>
      ipcRenderer.invoke('system:open-editor', validateOpenEditorPath(filePath)),
    readMarkdownDocument: (input) =>
      ipcRenderer.invoke('system:read-markdown-document', validateReadMarkdownDocumentInput(input)),
    selectDirectory: () => ipcRenderer.invoke('system:select-directory'),
    selectBackgroundImage: () => ipcRenderer.invoke('system:select-background-image'),
    loadBackgroundImage: (filePath) =>
      ipcRenderer.invoke('system:load-background-image', filePath),
    checkAgentInstalled: (agentId) => ipcRenderer.invoke('system:check-agent', agentId),
    listAgentModels: () => ipcRenderer.invoke('system:list-agent-models'),
    listCapabilities: () => ipcRenderer.invoke('system:list-capabilities'),
    getAgentProfileDoctor: (projectId) =>
      ipcRenderer.invoke('system:agent-profile-doctor', assertPlainId(projectId, 'Project id')),
    runDoctor: (projectId) =>
      ipcRenderer.invoke('system:run-doctor', projectId),
    listVerificationRecipes: (projectId) =>
      ipcRenderer.invoke('system:list-verification-recipes', projectId),
    listManagedCliRuntimes: () => ipcRenderer.invoke('system:list-managed-cli-runtimes'),
    runManagedCliAction: (input) => ipcRenderer.invoke('system:run-managed-cli-action', input),
    saveAttachment: (input) => ipcRenderer.invoke('system:save-attachment', input),
    copyImageToClipboard: (input) =>
      ipcRenderer.invoke('system:copy-image-to-clipboard', input),
    saveImageFile: (input) => ipcRenderer.invoke('system:save-image-file', input),
    listEditors: () => ipcRenderer.invoke('system:list-editors'),
    openProjectIn: (input) =>
      ipcRenderer.invoke('system:open-in-editor', validateOpenInEditorInput(input)),
    startCliEditorTerminal: (input) =>
      ipcRenderer.invoke(
        'system:start-cli-editor-terminal',
        validateCliEditorTerminalStartInput(input),
      ),
    writeCliEditorTerminal: (input) =>
      ipcRenderer.invoke(
        'system:write-cli-editor-terminal',
        validateCliEditorTerminalWriteInput(input),
      ),
    resizeCliEditorTerminal: (input) =>
      ipcRenderer.invoke(
        'system:resize-cli-editor-terminal',
        validateCliEditorTerminalResizeInput(input),
      ),
    stopCliEditorTerminal: (sessionId) =>
      ipcRenderer.invoke('system:stop-cli-editor-terminal', assertPlainId(sessionId, 'Session id')),
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
