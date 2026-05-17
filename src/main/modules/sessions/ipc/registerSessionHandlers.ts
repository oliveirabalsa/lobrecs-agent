import { ipcMain } from 'electron'
import { sessionsStore } from '../../../store'

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
}
