import type { AgentEvent, SessionStatus } from './sessions'
import type { SupportedAgentId } from './agents'
import { assertNoShellBreaks, assertPlainId, assertRecord, assertString } from './validation'

export type RunMode = 'local' | 'worktree' | 'remote-placeholder'

export type WorktreeExecutionLocation = 'local' | 'worktree'

export type WorktreeSnapshotStatus =
  | 'clean'
  | 'dirty'
  | 'conflicted'
  | 'missing'
  | 'restored'

export type WorktreeCleanupPolicy =
  | 'keep-until-thread-closed'
  | 'remove-after-bring-back'
  | 'manual'

export interface WorktreeSessionMetadata {
  projectId: string
  threadId: string
  location: WorktreeExecutionLocation
  worktreePath?: string
  branch?: string
  baseBranch?: string
  baseCommit?: string
  snapshotStatus: WorktreeSnapshotStatus
  cleanupPolicy: WorktreeCleanupPolicy
  updatedAt: number
}

export type SpecRunStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'reviewing'
  | 'verified'
  | 'failed'
  | 'cancelled'

export type RunAttemptStatus =
  | 'queued'
  | 'running'
  | 'reviewing'
  | 'done'
  | 'failed'
  | 'cancelled'

export type VerificationStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped'

export type VerificationRecipeScope = 'build' | 'test' | 'lint' | 'ui' | 'custom'

export interface AdapterCapability {
  agentId: SupportedAgentId
  name: string
  installed: boolean
  supportsStreamingJson: boolean
  supportsResume: boolean
  supportsFileAttachments: boolean
  supportsCustomAgents: boolean
  supportsMcp: boolean
  supportsApprovalMode: boolean
  supportsModelListing: boolean
}

export type NormalizedAgentEvent =
  | { kind: 'text'; text: string; role?: 'assistant' | 'system' }
  | { kind: 'tool-call'; name: string; input?: unknown }
  | { kind: 'command'; command: string; cwd?: string }
  | { kind: 'file-proposal'; filePath: string; additions?: number; deletions?: number }
  | { kind: 'approval-request'; risk?: 'low' | 'medium' | 'high'; payload: unknown }
  | { kind: 'usage'; tokensIn?: number; tokensOut?: number; costUsd?: number }
  | { kind: 'completion'; status: SessionStatus; payload?: unknown }
  | { kind: 'raw'; event: AgentEvent }

export interface SpecRun {
  id: string
  specId: string
  status: SpecRunStatus
  mode: RunMode
  createdAt: number
  completedAt?: number
}

export interface RunAttempt {
  id: string
  specRunId: string
  sessionId?: string
  agentId: SupportedAgentId
  model?: string
  status: RunAttemptStatus
  costUsd?: number
  durationMs?: number
  risk?: 'low' | 'medium' | 'high'
  createdAt: number
  completedAt?: number
}

export interface VerificationResult {
  id: string
  specRunId: string
  command: string
  status: VerificationStatus
  output?: string
  createdAt: number
  completedAt?: number
}

export interface VerificationRecipe {
  id: string
  label: string
  command: string
  scope: VerificationRecipeScope
  description?: string
}

export interface VisualEvidenceViewport {
  width: number
  height: number
  deviceScaleFactor?: number
}

export interface VisualEvidenceScreenshot {
  mimeType: 'image/png'
  width: number
  height: number
  sizeBytes: number
  dataUrl?: string
}

export interface VisualEvidenceConsoleError {
  message: string
  source?: string
  line?: number
  createdAt: number
}

export interface VisualEvidenceNetworkFailure {
  url: string
  method?: string
  errorText: string
  statusCode?: number
  createdAt: number
}

export interface VisualEvidenceRecord {
  id: string
  kind: 'local-web'
  status: 'captured' | 'failed'
  url: string
  finalUrl?: string
  title?: string
  viewport: VisualEvidenceViewport
  screenshot?: VisualEvidenceScreenshot
  consoleErrors: VisualEvidenceConsoleError[]
  networkFailures: VisualEvidenceNetworkFailure[]
  replayNotes?: string
  capturedAt: number
}

export interface CaptureLocalWebVisualEvidenceInput {
  url: string
  viewport?: Partial<VisualEvidenceViewport>
  replayNotes?: string
}

export interface StartSpecRunInput {
  specId: string
  mode?: RunMode
}

export interface StartSpecRunResult {
  run: SpecRun
  attempts: RunAttempt[]
}

export interface SpecRunComparison {
  specId: string
  runs: SpecRun[]
  attempts: RunAttempt[]
  verificationResults: VerificationResult[]
}

export type RunAuditPhase =
  | 'recipe-started'
  | 'recipe-passed'
  | 'recipe-failed'
  | 'visual-captured'
  | 'visual-failed'
  | 'repair-dispatched'
  | 'repair-skipped'
  | 'gate-passed'
  | 'gate-stopped'

export type RunAuditStopReason =
  | 'passed'
  | 'max-attempts'
  | 'repeat-failure'
  | 'no-diff'
  | 'manual-review'
  | 'cancelled'
  | 'repair-in-flight'
  | 'extension-gated'

export interface RunAuditRecord {
  id: string
  specRunId?: string
  sessionId: string
  threadId?: string
  attempt: number
  phase: RunAuditPhase
  recipeId?: string
  recipeLabel?: string
  command?: string
  exitCode?: number
  outputTail?: string
  changedFiles?: string[]
  repairSessionId?: string
  stopReason?: RunAuditStopReason
  finalStatus?: 'passed' | 'failed' | 'pending'
  visualEvidence?: VisualEvidenceRecord
  createdAt: number
}

export function validateRunId(input: unknown): string {
  return assertPlainId(input, 'Run id')
}

export function validateSessionId(input: unknown): string {
  return assertPlainId(input, 'Session id')
}

export function validateSpecId(input: unknown): string {
  return assertPlainId(input, 'Spec id')
}

export function validateStartSpecRunInput(input: unknown): StartSpecRunInput {
  const value = assertRecord(input, 'Run start input')
  const mode = value.mode
  if (
    mode !== undefined &&
    mode !== 'local' &&
    mode !== 'worktree' &&
    mode !== 'remote-placeholder'
  ) {
    throw new Error('Run mode is invalid.')
  }

  return {
    specId: assertPlainId(value.specId, 'Spec id'),
    mode,
  }
}

export function validateVerificationCommand(input: unknown): string {
  return assertNoShellBreaks(
    assertString(input, 'Verification command', { maxLength: 4_000 }),
    'Verification command',
  )
}

export function validateCaptureLocalWebVisualEvidenceInput(
  input: unknown,
): CaptureLocalWebVisualEvidenceInput {
  const value = assertRecord(input, 'Visual evidence input')
  const url = assertString(value.url, 'Visual evidence URL', { maxLength: 2_000 }).trim()
  if (!url) {
    throw new Error('Visual evidence URL is required.')
  }

  const viewportRecord =
    value.viewport === undefined ? undefined : assertRecord(value.viewport, 'Viewport')
  const viewport = viewportRecord
    ? {
        width: viewportNumber(viewportRecord.width, 'Viewport width', 1280, 320, 3840),
        height: viewportNumber(viewportRecord.height, 'Viewport height', 720, 240, 2160),
        deviceScaleFactor: viewportNumber(
          viewportRecord.deviceScaleFactor,
          'Viewport device scale factor',
          1,
          1,
          3,
        ),
      }
    : undefined

  const replayNotes =
    value.replayNotes === undefined
      ? undefined
      : assertString(value.replayNotes, 'Replay notes', { maxLength: 1_000 }).trim()

  return {
    url,
    viewport,
    replayNotes: replayNotes || undefined,
  }
}

function viewportNumber(
  input: unknown,
  label: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (input === undefined || input === null || input === '') return fallback
  const value = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a number.`)
  }

  return Math.max(min, Math.min(max, Math.round(value)))
}
