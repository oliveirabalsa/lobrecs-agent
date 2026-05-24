import type { AdapterCapability, VerificationRecipe } from './runs'
import type { ImageAttachment, SupportedAgentId } from './agents'

export type SelectedDirectoryPath = string | null

export interface SaveImageAttachmentInput {
  dataUrl: string
  name?: string
  mimeType?: string
}

export interface ReadMarkdownDocumentInput {
  href: string
  repoPath?: string
}

export interface MarkdownDocument {
  title: string
  content: string
  suggestedFileName: string
  size: number
  sourcePath?: string
  sourceUrl?: string
}

export type EditorKind = 'gui' | 'cli'

export interface EditorInfo {
  id: string
  name: string
  kind: EditorKind
}

export interface OpenInEditorInput {
  editorId: string
  repoPath: string
}

export interface CliEditorTerminalStartInput {
  sessionId?: string
  editorId: string
  repoPath: string
  cols?: number
  rows?: number
}

export interface CliEditorTerminalSession {
  sessionId: string
  editorId: string
  editorName: string
  repoPath: string
  command: string
}

export interface CliEditorTerminalWriteInput {
  sessionId: string
  data: string
}

export interface CliEditorTerminalResizeInput {
  sessionId: string
  cols: number
  rows: number
}

export interface CliEditorTerminalDataEvent {
  sessionId: string
  data: string
}

export interface CliEditorTerminalExitEvent {
  sessionId: string
  exitCode: number
  signal?: number
}

export const TERMINAL_COMMAND_STATUS_PREFIX = '\u001b]133;D;'
export const TERMINAL_COMMAND_STATUS_SUFFIX = '\u0007'

export interface TerminalFailureContext {
  terminalSessionId: string
  repoPath: string
  editorId: string
  editorName: string
  command?: string
  exitCode: number
  signal?: number
  outputTail: string
  capturedAt: number
}

export type ManagedCliActionId =
  | 'install'
  | 'upgrade'
  | 'auth-status'
  | 'doctor'
  | 'models'

export interface ManagedCliAction {
  id: ManagedCliActionId
  label: string
  description: string
  commandPreview: string
  requiresInstalled: boolean
  available: boolean
  unavailableReason?: string
}

export interface ManagedCliStatus {
  agentId: SupportedAgentId
  name: string
  command: string
  commandPath?: string
  installed: boolean
  version?: string
  versionError?: string
  latestVersion?: string
  latestVersionError?: string
  updateAvailable: boolean
  docsUrl: string
  installSummary: string
  notes: string[]
  actions: ManagedCliAction[]
}

export interface RunManagedCliActionInput {
  agentId: SupportedAgentId
  actionId: ManagedCliActionId
  repoPath?: string
}

export interface ManagedCliActionResult {
  agentId: SupportedAgentId
  actionId: ManagedCliActionId
  command: string
  exitCode: number | null
  signal?: string | null
  stdout: string
  stderr: string
  startedAt: number
  finishedAt: number
}

export type { AdapterCapability, VerificationRecipe }
export type { ImageAttachment }
