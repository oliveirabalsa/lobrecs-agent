import type {
  MultitaskDecomposeRequest,
  MultitaskDecomposeResult,
  MultitaskDecisionPayload,
  MultitaskExecuteRequest,
} from '../../shared/contracts/multitask'
import type { SwarmResult } from '../../shared/contracts/swarms'
import type { IpcInvoker } from './ipc'

export interface MultitaskApi {
  decompose(request: MultitaskDecomposeRequest): Promise<MultitaskDecomposeResult>
  execute(request: MultitaskExecuteRequest): Promise<SwarmResult>
  decision(payload: MultitaskDecisionPayload): Promise<void>
}

export function createMultitaskApi(ipcRenderer: IpcInvoker): MultitaskApi {
  return {
    decompose: (request) => ipcRenderer.invoke('multitask:decompose', request),
    execute: (request) => ipcRenderer.invoke('multitask:execute', request),
    decision: (payload) => ipcRenderer.invoke('multitask:decision', payload),
  }
}
