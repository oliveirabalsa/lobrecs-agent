import type {
  AgentEvent,
  ListThreadTranscriptOptions,
  Session,
  SessionForkPayload,
  ThreadTranscriptTurn,
} from '../../shared/contracts/sessions'
import type { IpcInvoker } from './ipc'

export interface SessionsApi {
  list(projectId: string): Promise<Session[]>
  listByThread(threadId: string): Promise<Session[]>
  get(sessionId: string): Promise<Session | null>
  fork(sessionId: string): Promise<SessionForkPayload>
  listEvents(sessionId: string): Promise<AgentEvent[]>
  listEventsForSessions(sessionIds: string[]): Promise<Record<string, AgentEvent[]>>
  listThreadTranscript(
    threadId: string,
    options?: ListThreadTranscriptOptions,
  ): Promise<ThreadTranscriptTurn[]>
}

export function createSessionsApi(ipcRenderer: IpcInvoker): SessionsApi {
  return {
    list: (projectId) => ipcRenderer.invoke('sessions:list', projectId),
    listByThread: (threadId) => ipcRenderer.invoke('sessions:list-by-thread', threadId),
    get: (sessionId) => ipcRenderer.invoke('sessions:get', sessionId),
    fork: (sessionId) => ipcRenderer.invoke('sessions:fork', sessionId),
    listEvents: (sessionId) => ipcRenderer.invoke('sessions:list-events', sessionId),
    listEventsForSessions: (sessionIds) =>
      ipcRenderer.invoke('sessions:list-events-for-sessions', sessionIds),
    listThreadTranscript: (threadId, options) =>
      ipcRenderer.invoke('sessions:list-thread-transcript', threadId, options),
  }
}
