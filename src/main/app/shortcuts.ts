import { globalShortcut, type BrowserWindow } from 'electron'

export type MainWindowProvider = () => BrowserWindow | null

export function registerAppShortcuts(getMainWindow: MainWindowProvider): void {
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    getMainWindow()?.webContents.send('shortcut:approve')
  })

  globalShortcut.register('CommandOrControl+Shift+X', () => {
    getMainWindow()?.webContents.send('shortcut:kill-all')
  })

  globalShortcut.register('CommandOrControl+Shift+S', () => {
    getMainWindow()?.webContents.send('shortcut:swarm')
  })
}

export function unregisterAppShortcuts(): void {
  globalShortcut.unregisterAll()
}
