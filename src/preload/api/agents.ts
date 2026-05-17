import type { AgentDispatchParams, AgentDispatchResult } from '../../shared/contracts/agents'
import type { IpcInvoker } from './ipc'

export interface AgentApi {
  dispatch(params: AgentDispatchParams): Promise<AgentDispatchResult>
  approve(sessionId: string): Promise<void>
  reject(sessionId: string): Promise<void>
  cancel(sessionId: string): Promise<void>
  killAll(): Promise<void>
}

export function createAgentApi(ipcRenderer: IpcInvoker): AgentApi {
  return {
    dispatch: (params) => ipcRenderer.invoke('agent:dispatch', params),
    approve: (sessionId) => ipcRenderer.invoke('agent:approve', sessionId),
    reject: (sessionId) => ipcRenderer.invoke('agent:reject', sessionId),
    cancel: (sessionId) => ipcRenderer.invoke('agent:cancel', sessionId),
    killAll: () => ipcRenderer.invoke('agent:kill-all'),
  }
}
