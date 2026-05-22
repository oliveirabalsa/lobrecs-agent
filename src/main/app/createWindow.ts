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
    // Renderer content includes untrusted agent and terminal output, so a
    // link could carry any scheme. Only hand web/mail URLs to the OS — drop
    // file:, smb:, and custom app schemes that could trigger an OS handler.
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

const SAFE_EXTERNAL_SCHEMES = new Set(['https:', 'http:', 'mailto:'])

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    return SAFE_EXTERNAL_SCHEMES.has(new URL(rawUrl).protocol)
  } catch {
    return false // malformed URL — never forward it to the OS
  }
}

function getPreloadPath(): string {
  const candidates = [
    join(__dirname, '../preload/index.mjs'),
    join(__dirname, '../preload/index.js'),
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}
