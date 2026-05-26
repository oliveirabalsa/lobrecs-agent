import { app, BrowserWindow } from 'electron'
import { adapterRegistry } from '../agents'
import { registerIpcHandlers } from '../ipc'
import { automationSchedulerService } from '../modules/automations/application/automationSchedulerService'
import { cliEditorTerminalService } from '../modules/system/application/cliEditorTerminalService'
import { appUpdateService } from '../modules/updates'
import { processPool } from '../process/ProcessPool'
import { sessionsStore, threadsStore } from '../store'
import { getAppIconPath } from './appIcon'
import { createMainWindow } from './createWindow'
import { setApplicationMenu } from './menu'
import { registerAppShortcuts, unregisterAppShortcuts } from './shortcuts'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function bootstrapMainProcess(): void {
  app.setAppUserModelId(app.name)

  app.whenReady().then(async () => {
    setDockIcon()
    setApplicationMenu()
    registerIpcHandlers()
    automationSchedulerService.start()
    cancelInterruptedSessions()
    backfillThreadsFromSessions()
    await clearStaleDownloadedUpdates()
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
    automationSchedulerService.stop()
    cliEditorTerminalService.stopAll()
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

async function clearStaleDownloadedUpdates(): Promise<void> {
  try {
    await appUpdateService.clearStaleDownloadedUpdates()
  } catch (error) {
    console.error('[updates] failed to clear stale downloaded updates:', error)
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
