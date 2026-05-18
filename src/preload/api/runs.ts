import type {
  SpecRun,
  SpecRunComparison,
  StartSpecRunInput,
  StartSpecRunResult,
  VerificationResult,
} from '../../shared/contracts/runs'
import type { IpcInvoker } from './ipc'

export interface RunsApi {
  start(input: StartSpecRunInput): Promise<StartSpecRunResult>
  cancel(runId: string): Promise<SpecRun>
  compare(specId: string): Promise<SpecRunComparison>
  verify(runId: string, command: string): Promise<VerificationResult>
}

export function createRunsApi(ipcRenderer: IpcInvoker): RunsApi {
  return {
    start: (input) => ipcRenderer.invoke('runs:start', input),
    cancel: (runId) => ipcRenderer.invoke('runs:cancel', runId),
    compare: (specId) => ipcRenderer.invoke('runs:compare', specId),
    verify: (runId, command) => ipcRenderer.invoke('runs:verify', runId, command),
  }
}
