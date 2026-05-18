import type { IpcRendererEvent } from 'electron'
import type {
  CreateThreadInput,
  ListThreadsOptions,
  Thread,
  ThreadDeletedEvent,
  ThreadUpdatedEvent,
} from '../../shared/contracts/threads'
import type { IpcInvoker, IpcSubscriber } from './ipc'

export interface ThreadsApi {
  list(projectId: string, opts?: ListThreadsOptions): Promise<Thread[]>
  get(id: string): Promise<Thread | null>
  create(data: CreateThreadInput): Promise<Thread>
  rename(params: { id: string; title: string }): Promise<Thread>
  delete(id: string): Promise<void>
  pin(params: { id: string; pinned: boolean }): Promise<Thread>
  archive(id: string): Promise<Thread>
  /**
   * Subscribe to `thread:updated` broadcasts emitted whenever main mutates a
   * thread's metadata (create / rename / pin / archive / lastSessionId bump).
   * Returns an unsubscribe function. Renderer-side listeners use this to keep
   * the sidebar tree in sync without polling.
   */
  onUpdated(callback: (event: ThreadUpdatedEvent) => void): () => void
  /** Subscribe to thread deletion broadcasts so renderer state can drop stale rows. */
  onDeleted(callback: (event: ThreadDeletedEvent) => void): () => void
}

export function createThreadsApi(
  ipcRenderer: IpcInvoker & IpcSubscriber,
): ThreadsApi {
  return {
    list: (projectId, opts) => ipcRenderer.invoke('threads:list', projectId, opts),
    get: (id) => ipcRenderer.invoke('threads:get', id),
    create: (data) => ipcRenderer.invoke('threads:create', data),
    rename: (params) => ipcRenderer.invoke('threads:rename', params),
    delete: (id) => ipcRenderer.invoke('threads:delete', id),
    pin: (params) => ipcRenderer.invoke('threads:pin', params),
    archive: (id) => ipcRenderer.invoke('threads:archive', id),
    onUpdated: (callback) => {
      const handler = (_event: IpcRendererEvent, payload: ThreadUpdatedEvent) =>
        callback(payload)
      ipcRenderer.on('thread:updated', handler)
      return () => ipcRenderer.removeListener('thread:updated', handler)
    },
    onDeleted: (callback) => {
      const handler = (_event: IpcRendererEvent, payload: ThreadDeletedEvent) =>
        callback(payload)
      ipcRenderer.on('thread:deleted', handler)
      return () => ipcRenderer.removeListener('thread:deleted', handler)
    },
  }
}
