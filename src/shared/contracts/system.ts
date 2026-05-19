import type { AdapterCapability, VerificationRecipe } from './runs'
import type { ImageAttachment } from './agents'

export type SelectedDirectoryPath = string | null

export interface SaveImageAttachmentInput {
  dataUrl: string
  name?: string
  mimeType?: string
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

export type { AdapterCapability, VerificationRecipe }
export type { ImageAttachment }
