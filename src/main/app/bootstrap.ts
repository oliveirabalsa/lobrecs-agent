import { app, BrowserWindow } from 'electron'
import { adapterRegistry } from '../agents'
import { registerIpcHandlers } from '../ipc'
import { processPool } from '../process/ProcessPool'
import { sessionsStore, threadsStore } from '../store'
import { getAppIconPath } from './appIcon'
import { createMainWindow } from './createWindow'
import { registerAppShortcuts, unregisterAppShortcuts } from './shortcuts'

let mainWindow: BrowserWindow | null = null

export function bootstrapMainProcess(): void {
  app.whenReady().then(async () => {
    setDockIcon()
    registerIpcHandlers()
    cancelInterruptedSessions()
    backfillThreadsFromSessions()
    await logAdapterAvailability()
    mainWindow = createMainWindow()
    registerAppShortcuts(() => mainWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('will-quit', () => {
    processPool.killAll()
    unregisterAppShortcuts()
  })

  process.on('uncaughtException', (error) => {
    console.error('[main] uncaughtException:', error)
    processPool.killAll()
  })
}

function cancelInterruptedSessions(): void {
  const cancelled = sessionsStore.cancelInterrupted()
  if (cancelled > 0) {
    console.log(`[sessions] cancelled ${cancelled} interrupted session(s)`)
  }
}

function backfillThreadsFromSessions(): void {
  try {
    const created = threadsStore.backfillFromSessions()
    if (created > 0) {
      console.log(`[threads] backfilled ${created} thread(s) from existing sessions`)
    }
  } catch (error) {
    console.error('[threads] backfill failed:', error)
  }
}

function setDockIcon(): void {
  const icon = getAppIconPath()

  if (process.platform === 'darwin' && icon && app.dock) {
    app.dock.setIcon(icon)
  }
}

async function logAdapterAvailability(): Promise<void> {
  await Promise.all(
    [...adapterRegistry.entries()].map(async ([id, adapter]) => {
      const installed = await adapter.isInstalled().catch(() => false)
      console.log(`[agents] ${id}: ${installed ? 'OK' : 'NOT FOUND'}`)
    }),
  )
}
