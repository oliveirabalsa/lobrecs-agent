import type { AdapterCapability, VerificationRecipe } from './runs'
import type { AgentProfileDoctorReport } from './agentProfiles'
import type { ImageAttachment, SupportedAgentId } from './agents'
import {
  assertAbsolutePath,
  assertPlainId,
  assertRecord,
  assertString,
  optionalInteger,
  optionalString,
} from './validation'

export type SelectedDirectoryPath = string | null

export interface SaveAttachmentInput {
  /** Base64 `data:` URL of the file's bytes, as read in the renderer. */
  dataUrl: string
  name?: string
  mimeType?: string
}

export interface ImagePreviewSourceInput {
  source: string
  suggestedName?: string
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

export interface DoctorCheck {
  id: string
  name: string
  status: 'passed' | 'warning' | 'failed' | 'not-run'
  message: string
  details?: string
}

export interface DoctorReport {
  checkedAt: number
  overallStatus: 'passed' | 'warning' | 'failed'
  checks: DoctorCheck[]
}

export interface InstalledExtensionInventoryItem {
  id: string
  name: string
  agentId: string
  category: 'mcp-server' | 'plugin' | 'skill'
  scope: 'project' | 'global'
  health: 'passed' | 'warning' | 'failed'
  healthMessage: string
  authState: 'none' | 'configured' | 'missing-credentials'
  exposedTools: string[]
  isSecretRedacted: boolean
  details?: {
    command?: string
    args?: string[]
    url?: string
    env?: Record<string, string>
    headers?: Record<string, string>
    filePath?: string
  }
}

export type { AdapterCapability, VerificationRecipe }
export type { AgentProfileDoctorReport }
export type { ImageAttachment }

export function validateOpenEditorPath(input: unknown): string {
  return assertAbsolutePath(input, 'File path')
}

export function validateReadMarkdownDocumentInput(input: unknown): ReadMarkdownDocumentInput {
  const value = assertRecord(input, 'Markdown preview input')
  return {
    href: assertString(value.href, 'Markdown href', { maxLength: 4096 }),
    repoPath:
      value.repoPath === undefined || value.repoPath === null
        ? undefined
        : assertAbsolutePath(value.repoPath, 'Repository path'),
  }
}

export function validateOpenInEditorInput(input: unknown): OpenInEditorInput {
  const value = assertRecord(input, 'Open in editor input')
  return {
    editorId: assertString(value.editorId, 'Editor id', { maxLength: 120 }),
    repoPath: assertAbsolutePath(value.repoPath, 'Repository path'),
  }
}

export function validateCliEditorTerminalStartInput(
  input: unknown,
): CliEditorTerminalStartInput {
  const value = assertRecord(input, 'CLI editor terminal input')
  return {
    sessionId: optionalString(value.sessionId, 'Terminal session id', { maxLength: 200 }),
    editorId: assertString(value.editorId, 'Editor id', { maxLength: 120 }),
    repoPath: assertAbsolutePath(value.repoPath, 'Repository path'),
    cols: optionalInteger(value.cols, 'Terminal columns', { min: 20, max: 500 }),
    rows: optionalInteger(value.rows, 'Terminal rows', { min: 5, max: 200 }),
  }
}

export function validateCliEditorTerminalWriteInput(
  input: unknown,
): CliEditorTerminalWriteInput {
  const value = assertRecord(input, 'CLI editor terminal write input')
  return {
    sessionId: assertPlainId(value.sessionId, 'Terminal session id'),
    data: assertCliEditorTerminalData(value.data),
  }
}

export function validateCliEditorTerminalResizeInput(
  input: unknown,
): CliEditorTerminalResizeInput {
  const value = assertRecord(input, 'CLI editor terminal resize input')
  return {
    sessionId: assertPlainId(value.sessionId, 'Terminal session id'),
    cols: optionalInteger(value.cols, 'Terminal columns', { min: 20, max: 500 }) ?? 80,
    rows: optionalInteger(value.rows, 'Terminal rows', { min: 5, max: 200 }) ?? 24,
  }
}

function assertCliEditorTerminalData(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Terminal input must be a string.')
  }
  if (value.length > 20_000) {
    throw new Error('Terminal input is too long.')
  }
  if (value.includes('\u0000')) {
    throw new Error('Terminal input contains unsupported null bytes.')
  }

  return value
}
