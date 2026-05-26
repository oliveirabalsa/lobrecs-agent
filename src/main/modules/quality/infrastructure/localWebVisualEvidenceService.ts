import { randomUUID } from 'node:crypto'
import type {
  CaptureLocalWebVisualEvidenceInput,
  VisualEvidenceConsoleError,
  VisualEvidenceNetworkFailure,
  VisualEvidenceRecord,
  VisualEvidenceViewport,
} from '../../../../shared/types'

export interface LocalWebBrowserCapture {
  finalUrl?: string
  title?: string
  screenshot?: {
    dataUrl?: string
    width: number
    height: number
    sizeBytes: number
  }
  consoleErrors: VisualEvidenceConsoleError[]
  networkFailures: VisualEvidenceNetworkFailure[]
}

export type LocalWebBrowserRunner = (
  url: string,
  viewport: VisualEvidenceViewport,
) => Promise<LocalWebBrowserCapture>

export interface CaptureLocalWebVisualEvidenceOptions {
  runner?: LocalWebBrowserRunner
}

const DEFAULT_VIEWPORT: VisualEvidenceViewport = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

export async function captureLocalWebVisualEvidence(
  input: CaptureLocalWebVisualEvidenceInput,
  options: CaptureLocalWebVisualEvidenceOptions = {},
): Promise<VisualEvidenceRecord> {
  const url = normalizeLocalWebUrl(input.url)
  const viewport = normalizeViewport(input.viewport)
  const runner = options.runner ?? electronBrowserRunner
  const capture = await runner(url, viewport)
  const capturedAt = Date.now()
  const status = capture.networkFailures.length > 0 ? 'failed' : 'captured'

  return {
    id: randomUUID(),
    kind: 'local-web',
    status,
    url,
    finalUrl: capture.finalUrl,
    title: capture.title,
    viewport,
    screenshot: capture.screenshot
      ? {
          mimeType: 'image/png',
          ...capture.screenshot,
        }
      : undefined,
    consoleErrors: capture.consoleErrors,
    networkFailures: capture.networkFailures,
    replayNotes: input.replayNotes,
    capturedAt,
  }
}

export function normalizeLocalWebUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('Visual evidence URL must be an absolute local http(s) URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Visual evidence URL must use http or https.')
  }

  const hostname = url.hostname.toLowerCase()
  if (!LOCAL_HOSTS.has(hostname) && !hostname.endsWith('.localhost')) {
    throw new Error('Visual evidence capture is limited to localhost targets.')
  }

  return url.toString()
}

function normalizeViewport(
  input: CaptureLocalWebVisualEvidenceInput['viewport'],
): VisualEvidenceViewport {
  return {
    width: input?.width ?? DEFAULT_VIEWPORT.width,
    height: input?.height ?? DEFAULT_VIEWPORT.height,
    deviceScaleFactor: input?.deviceScaleFactor ?? DEFAULT_VIEWPORT.deviceScaleFactor,
  }
}

async function electronBrowserRunner(
  url: string,
  viewport: VisualEvidenceViewport,
): Promise<LocalWebBrowserCapture> {
  const electron = await import('electron')
  const BrowserWindow = electron.BrowserWindow
  if (!BrowserWindow) {
    throw new Error('Electron BrowserWindow is not available for visual evidence capture.')
  }

  const consoleErrors: VisualEvidenceConsoleError[] = []
  const networkFailures: VisualEvidenceNetworkFailure[] = []
  const window = new BrowserWindow({
    show: false,
    width: viewport.width,
    height: viewport.height,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  try {
    window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level < 3) return
      consoleErrors.push({
        message,
        source: sourceId || undefined,
        line: line || undefined,
        createdAt: Date.now(),
      })
    })

    window.webContents.on(
      'did-fail-load',
      (_event, _errorCode, errorDescription, validatedUrl) => {
        networkFailures.push({
          url: validatedUrl || url,
          errorText: errorDescription,
          createdAt: Date.now(),
        })
      },
    )

    window.webContents.session.webRequest.onErrorOccurred(
      { urls: ['http://*/*', 'https://*/*'] },
      (details) => {
        networkFailures.push({
          url: details.url,
          method: details.method,
          errorText: details.error,
          createdAt: Date.now(),
        })
      },
    )

    await loadWithTimeout(window, url, 15_000)
    await wait(250)
    const image = await window.webContents.capturePage()
    const size = image.getSize()
    const dataUrl = image.toDataURL()

    return {
      finalUrl: window.webContents.getURL() || undefined,
      title: window.webContents.getTitle() || undefined,
      screenshot: {
        dataUrl,
        width: size.width,
        height: size.height,
        sizeBytes: Buffer.byteLength(dataUrl),
      },
      consoleErrors,
      networkFailures: dedupeNetworkFailures(networkFailures),
    }
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}

async function loadWithTimeout(
  window: Electron.BrowserWindow,
  url: string,
  timeoutMs: number,
): Promise<void> {
  await Promise.race([
    window.loadURL(url).catch(() => undefined),
    new Promise<void>((resolve) => {
      window.webContents.once('did-finish-load', () => resolve())
      window.webContents.once('did-fail-load', () => resolve())
    }),
    new Promise<void>((_resolve, reject) => {
      setTimeout(() => reject(new Error('Timed out capturing local web evidence.')), timeoutMs)
    }),
  ])
}

function dedupeNetworkFailures(
  failures: readonly VisualEvidenceNetworkFailure[],
): VisualEvidenceNetworkFailure[] {
  const seen = new Set<string>()
  return failures.filter((failure) => {
    const key = `${failure.url}:${failure.errorText}:${failure.statusCode ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
