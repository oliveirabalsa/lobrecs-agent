import type { IpcRendererEvent } from 'electron'
import type { AgentEvent } from '../../shared/contracts/sessions'
import type { IpcSubscriber } from './ipc'

export interface AgentForgeEventsApi {
  on(event: string, callback: (payload: AgentEvent) => void): () => void
  onShortcut(event: string, callback: () => void): () => void
}

export function createEventApi(ipcRenderer: IpcSubscriber): AgentForgeEventsApi {
  return {
    on: (event, callback) => {
      const handler = (_event: IpcRendererEvent, payload: AgentEvent) => callback(payload)
      ipcRenderer.on(event, handler)

      return () => ipcRenderer.removeListener(event, handler)
    },
    onShortcut: (event, callback) => {
      const handler = () => callback()
      ipcRenderer.on(event, handler)

      return () => ipcRenderer.removeListener(event, handler)
    },
  }
}
