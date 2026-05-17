import type { AgentEvent, Session, SessionForkPayload } from '../../shared/contracts/sessions'
import type { IpcInvoker } from './ipc'

export interface SessionsApi {
  list(projectId: string): Promise<Session[]>
  get(sessionId: string): Promise<Session | null>
  fork(sessionId: string): Promise<SessionForkPayload>
  listEvents(sessionId: string): Promise<AgentEvent[]>
}

export function createSessionsApi(ipcRenderer: IpcInvoker): SessionsApi {
  return {
    list: (projectId) => ipcRenderer.invoke('sessions:list', projectId),
    get: (sessionId) => ipcRenderer.invoke('sessions:get', sessionId),
    fork: (sessionId) => ipcRenderer.invoke('sessions:fork', sessionId),
    listEvents: (sessionId) => ipcRenderer.invoke('sessions:list-events', sessionId),
  }
}
