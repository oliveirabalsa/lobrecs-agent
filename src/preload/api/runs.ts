import type {
  CaptureLocalWebVisualEvidenceInput,
  RunAuditRecord,
  SpecRun,
  SpecRunComparison,
  StartSpecRunInput,
  StartSpecRunResult,
  VerificationResult,
} from '../../shared/contracts/runs'
import {
  validateRunId,
  validateCaptureLocalWebVisualEvidenceInput,
  validateSessionId,
  validateSpecId,
  validateStartSpecRunInput,
  validateVerificationCommand,
} from '../../shared/contracts/runs'
import type { PromptEvidenceRecord } from '../../shared/contracts/promptEvidence'
import type { IpcInvoker } from './ipc'

export interface RunsApi {
  start(input: StartSpecRunInput): Promise<StartSpecRunResult>
  cancel(runId: string): Promise<SpecRun>
  compare(specId: string): Promise<SpecRunComparison>
  verify(runId: string, command: string): Promise<VerificationResult>
  listAuditRecords(runId: string): Promise<RunAuditRecord[]>
  listSessionAuditRecords(sessionId: string): Promise<RunAuditRecord[]>
  captureVisualEvidence(
    sessionId: string,
    input: CaptureLocalWebVisualEvidenceInput,
  ): Promise<RunAuditRecord>
  getPromptEvidence(sessionId: string): Promise<PromptEvidenceRecord | null>
}

export function createRunsApi(ipcRenderer: IpcInvoker): RunsApi {
  return {
    start: (input) => ipcRenderer.invoke('runs:start', validateStartSpecRunInput(input)),
    cancel: (runId) => ipcRenderer.invoke('runs:cancel', validateRunId(runId)),
    compare: (specId) => ipcRenderer.invoke('runs:compare', validateSpecId(specId)),
    verify: (runId, command) =>
      ipcRenderer.invoke(
        'runs:verify',
        validateRunId(runId),
        validateVerificationCommand(command),
      ),
    listAuditRecords: (runId) => ipcRenderer.invoke('runs:listAuditRecords', validateRunId(runId)),
    listSessionAuditRecords: (sessionId) =>
      ipcRenderer.invoke('runs:listSessionAuditRecords', validateSessionId(sessionId)),
    captureVisualEvidence: (sessionId, input) =>
      ipcRenderer.invoke(
        'runs:captureVisualEvidence',
        validateSessionId(sessionId),
        validateCaptureLocalWebVisualEvidenceInput(input),
      ),
    getPromptEvidence: (sessionId) =>
      ipcRenderer.invoke('runs:getPromptEvidence', validateSessionId(sessionId)),
  }
}
