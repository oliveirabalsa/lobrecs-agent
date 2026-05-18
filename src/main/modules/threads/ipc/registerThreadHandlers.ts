import { BrowserWindow, ipcMain } from 'electron'
import { threadsStore } from '../../../store'
import type {
  CreateThreadInput,
  ListThreadsOptions,
  Thread,
  ThreadDeletedEvent,
  ThreadUpdatedEvent,
} from '../../../../shared/types'

/**
 * Broadcasts a `thread:updated` event to every renderer window. The sidebar
 * uses this to keep its thread list in sync with main-process state.
 */
export function broadcastThreadUpdated(thread: Thread): void {
  const payload: ThreadUpdatedEvent = { threadId: thread.id, thread }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('thread:updated', payload)
  }
}

function broadcastThreadDeleted(threadId: string, projectId: string): void {
  const payload: ThreadDeletedEvent = { threadId, projectId }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('thread:deleted', payload)
  }
}

export function registerThreadHandlers(): void {
  ipcMain.handle(
    'threads:list',
    async (_event, projectId: string, opts?: ListThreadsOptions): Promise<Thread[]> => {
      return threadsStore.list(projectId, opts)
    },
  )

  ipcMain.handle('threads:get', async (_event, id: string): Promise<Thread | null> => {
    return threadsStore.get(id)
  })

  ipcMain.handle('threads:create', async (_event, data: CreateThreadInput): Promise<Thread> => {
    const thread = threadsStore.create(data)
    broadcastThreadUpdated(thread)
    return thread
  })

  ipcMain.handle(
    'threads:rename',
    async (_event, params: { id: string; title: string }): Promise<Thread> => {
      const thread = threadsStore.rename(params.id, params.title)
      broadcastThreadUpdated(thread)
      return thread
    },
  )

  ipcMain.handle('threads:delete', async (_event, id: string): Promise<void> => {
    const thread = threadsStore.get(id)
    threadsStore.delete(id)
    if (thread) {
      broadcastThreadDeleted(id, thread.projectId)
    }
  })

  ipcMain.handle(
    'threads:pin',
    async (_event, params: { id: string; pinned: boolean }): Promise<Thread> => {
      const thread = threadsStore.pin(params.id, params.pinned)
      broadcastThreadUpdated(thread)
      return thread
    },
  )

  ipcMain.handle('threads:archive', async (_event, id: string): Promise<Thread> => {
    const thread = threadsStore.archive(id)
    broadcastThreadUpdated(thread)
    return thread
  })
}
