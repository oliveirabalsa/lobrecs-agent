import { app, BrowserWindow } from 'electron'
import { adapterRegistry } from '../agents'
import { registerIpcHandlers } from '../ipc'
import { processPool } from '../process/ProcessPool'
import { createMainWindow } from './createWindow'
import { registerAppShortcuts, unregisterAppShortcuts } from './shortcuts'

let mainWindow: BrowserWindow | null = null

export function bootstrapMainProcess(): void {
  app.whenReady().then(async () => {
    registerIpcHandlers()
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

async function logAdapterAvailability(): Promise<void> {
  await Promise.all(
    [...adapterRegistry.entries()].map(async ([id, adapter]) => {
      const installed = await adapter.isInstalled().catch(() => false)
      console.log(`[agents] ${id}: ${installed ? 'OK' : 'NOT FOUND'}`)
    }),
  )
}
