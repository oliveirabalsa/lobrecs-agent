import { BrowserWindow, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getAppIconPath } from './appIcon'

export function createMainWindow(): BrowserWindow {
  const icon = getAppIconPath()

  const macOptions =
    process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 12 } }
      : {}

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: 'Lobrecs Agent',
    backgroundColor: '#0e0e0f',
    ...(icon ? { icon } : {}),
    ...macOptions,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function getPreloadPath(): string {
  const candidates = [
    join(__dirname, '../preload/index.mjs'),
    join(__dirname, '../preload/index.js'),
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}
