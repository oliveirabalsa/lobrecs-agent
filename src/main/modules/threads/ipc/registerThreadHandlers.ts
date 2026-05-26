import { BrowserWindow, ipcMain } from 'electron'
import { threadsStore } from '../../../store'
import {
  validateCreateThreadInput,
  validateListThreadsInput,
  validatePinThreadInput,
  validateRenameThreadInput,
  validateSearchThreadsInput,
  validateThreadId,
} from '../../../../shared/types'
import type {
  CreateThreadInput,
  SearchThreadsInput,
  Thread,
  ThreadSearchResult,
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
    async (_event, rawProjectId: unknown, rawOpts?: unknown): Promise<Thread[]> => {
      const { projectId, opts } = validateListThreadsInput(rawProjectId, rawOpts)
      return threadsStore.list(projectId, opts)
    },
  )

  ipcMain.handle('threads:get', async (_event, rawId: unknown): Promise<Thread | null> => {
    const id = validateThreadId(rawId)
    return threadsStore.get(id)
  })

  ipcMain.handle(
    'threads:search',
    async (_event, rawInput: unknown): Promise<ThreadSearchResult[]> => {
      const input: SearchThreadsInput = validateSearchThreadsInput(rawInput)
      return threadsStore.search(input)
    },
  )

  ipcMain.handle('threads:create', async (_event, rawData: unknown): Promise<Thread> => {
    const data: CreateThreadInput = validateCreateThreadInput(rawData)
    const thread = threadsStore.create(data)
    broadcastThreadUpdated(thread)
    return thread
  })

  ipcMain.handle(
    'threads:rename',
    async (_event, rawParams: unknown): Promise<Thread> => {
      const params = validateRenameThreadInput(rawParams)
      const thread = threadsStore.rename(params.id, params.title)
      broadcastThreadUpdated(thread)
      return thread
    },
  )

  ipcMain.handle('threads:delete', async (_event, rawId: unknown): Promise<void> => {
    const id = validateThreadId(rawId)
    const thread = threadsStore.get(id)
    threadsStore.delete(id)
    if (thread) {
      broadcastThreadDeleted(id, thread.projectId)
    }
  })

  ipcMain.handle(
    'threads:pin',
    async (_event, rawParams: unknown): Promise<Thread> => {
      const params = validatePinThreadInput(rawParams)
      const thread = threadsStore.pin(params.id, params.pinned)
      broadcastThreadUpdated(thread)
      return thread
    },
  )

  ipcMain.handle('threads:archive', async (_event, rawId: unknown): Promise<Thread> => {
    const id = validateThreadId(rawId)
    const thread = threadsStore.archive(id)
    broadcastThreadUpdated(thread)
    return thread
  })
}
