import { ipcMain } from 'electron'
import { sessionsStore } from '../../../store'
import type { AgentEvent } from '../../../../shared/types'

export function registerSessionHandlers(): void {
  ipcMain.handle('sessions:list', async (_event, projectId: string) =>
    sessionsStore.list(projectId),
  )
  ipcMain.handle('sessions:get', async (_event, sessionId: string) =>
    sessionsStore.get(sessionId),
  )
  ipcMain.handle('sessions:fork', async (_event, sessionId: string) =>
    sessionsStore.getForkPayload(sessionId),
  )
  ipcMain.handle('sessions:list-events', async (_event, sessionId: string) =>
    sessionsStore.listEvents(sessionId),
  )
  ipcMain.handle('sessions:list-thread-transcript', async (_event, threadId: string, options) =>
    sessionsStore.listThreadTranscript(threadId, options),
  )
  ipcMain.handle('sessions:list-by-thread', async (_event, threadId: string) => {
    if (typeof threadId !== 'string' || !threadId.trim()) {
      throw new Error('Invalid threadId: must be a non-empty string')
    }
    return sessionsStore.listByThread(threadId)
  })
  ipcMain.handle('sessions:list-events-for-sessions', async (_event, sessionIds: string[]) => {
    if (!Array.isArray(sessionIds)) {
      throw new Error('Invalid sessionIds: must be an array')
    }
    if (sessionIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new Error('Invalid sessionIds: all elements must be non-empty strings')
    }
    const eventsMap = sessionsStore.listEventsForSessions(sessionIds)
    const eventsRecord: Record<string, AgentEvent[]> = {}
    for (const [sessionId, events] of eventsMap) {
      eventsRecord[sessionId] = events
    }
    return eventsRecord
  })
}
