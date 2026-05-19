import { app, BrowserWindow, shell } from 'electron'
import electronUpdater, {
  type AppUpdater,
  type ProgressInfo,
  type UpdateDownloadedEvent,
  type UpdateInfo,
} from 'electron-updater'
import {
  APP_UPDATE_STATUS_CHANNEL,
  type AppUpdateProgress,
  type AppUpdateRelease,
  type AppUpdateState,
} from '../../../../shared/types'

const AUTO_CHECK_DELAY_MS = 3_000
const { autoUpdater } = electronUpdater
const RELEASES_URL = 'https://github.com/oliveirabalsa/lobrecs-agent-releases/releases/latest'

export interface CheckForUpdatesOptions {
  automatic?: boolean
}

export class AppUpdateService {
  private state: AppUpdateState
  private checkPromise: Promise<AppUpdateState> | null = null
  private downloadPromise: Promise<AppUpdateState> | null = null
  private automaticCheckTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly updater: AppUpdater = autoUpdater,
    private readonly isPackaged = app.isPackaged,
  ) {
    if (process.env.LOBRECS_AGENT_FORCE_DEV_UPDATE === '1') {
      this.updater.forceDevUpdateConfig = true
    }

    const feedUrl = process.env.LOBRECS_AGENT_UPDATE_URL?.trim()
    if (feedUrl) {
      this.updater.setFeedURL(feedUrl)
    }

    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = false
    this.updater.logger = console
    this.state = this.decorateState({
      currentVersion: app.getVersion(),
      phase: this.canUseUpdater() ? 'idle' : 'disabled',
      message: this.canUseUpdater()
        ? undefined
        : 'Updates are available from packaged builds only.',
      feedUrl: this.getFeedUrl(),
      canCheck: false,
      canDownload: false,
      canInstall: false,
    })

    this.registerUpdaterEvents()
  }

  getState(): AppUpdateState {
    return this.state
  }

  scheduleAutomaticCheck(enabled: boolean): void {
    if (!enabled || !this.canUseUpdater() || this.automaticCheckTimer) return

    this.automaticCheckTimer = setTimeout(() => {
      this.automaticCheckTimer = null
      void this.checkForUpdates({ automatic: true })
    }, AUTO_CHECK_DELAY_MS)
  }

  async checkForUpdates(_options: CheckForUpdatesOptions = {}): Promise<AppUpdateState> {
    if (!this.canUseUpdater()) {
      return this.setState({
        phase: 'disabled',
        error: undefined,
        progress: undefined,
        message: 'Updates are available from packaged builds only.',
      })
    }

    if (this.checkPromise) return this.checkPromise

    this.checkPromise = this.doCheckForUpdates().finally(() => {
      this.checkPromise = null
    })

    return this.checkPromise
  }

  async downloadUpdate(): Promise<AppUpdateState> {
    if (!this.canUseUpdater()) {
      return this.setState({
        phase: 'disabled',
        error: undefined,
        progress: undefined,
        message: 'Updates are available from packaged builds only.',
      })
    }

    if (this.state.phase === 'downloaded') return this.state
    if (this.downloadPromise) return this.downloadPromise
    if (this.state.phase !== 'available') {
      throw new Error('No update is available to download.')
    }

    this.downloadPromise = this.doDownloadUpdate().finally(() => {
      this.downloadPromise = null
    })

    return this.downloadPromise
  }

  installDownloadedUpdate(): void {
    if (this.state.phase !== 'downloaded') {
      throw new Error('No downloaded update is ready to install.')
    }

    this.updater.quitAndInstall(false, true)
  }

  async openReleaseUrl(): Promise<void> {
    await shell.openExternal(RELEASES_URL)
  }

  private async doCheckForUpdates(): Promise<AppUpdateState> {
    this.setState({
      phase: 'checking',
      error: undefined,
      progress: undefined,
      update: undefined,
      message: 'Checking for updates...',
      lastCheckedAt: Date.now(),
    })

    try {
      const result = await this.updater.checkForUpdates()

      if (!result) {
        return this.setState({
          phase: 'disabled',
          message: 'The update provider is not configured for this build.',
        })
      }

      if (!result.isUpdateAvailable) {
        return this.setState({
          phase: 'not-available',
          update: toRelease(result.updateInfo),
          message: 'Lobrecs Agent is up to date.',
        })
      }

      return this.setState({
        phase: 'available',
        update: toRelease(result.updateInfo),
        message: `Version ${result.updateInfo.version} is available.`,
      })
    } catch (error) {
      return this.setState({
        phase: 'error',
        progress: undefined,
        error: errorMessage(error),
        message: 'Could not check for updates.',
      })
    }
  }

  private async doDownloadUpdate(): Promise<AppUpdateState> {
    this.setState({
      phase: 'downloading',
      error: undefined,
      progress: {
        percent: 0,
        transferred: 0,
        total: 0,
        bytesPerSecond: 0,
      },
      message: 'Downloading update...',
    })

    try {
      await this.updater.downloadUpdate()
      if (this.state.phase !== 'downloaded') {
        return this.setState({
          phase: 'downloaded',
          progress: undefined,
          message: this.state.update
            ? `Version ${this.state.update.version} is ready to install.`
            : 'Update is ready to install.',
        })
      }
      return this.state
    } catch (error) {
      if (isMacosCodeSigningError(error)) {
        return this.setState({
          phase: 'error',
          progress: undefined,
          error: errorMessage(error),
          message: 'Automatic install is unavailable — the app is not code-signed. Download the update manually from GitHub.',
          canManualDownload: true,
          releaseUrl: RELEASES_URL,
        })
      }
      return this.setState({
        phase: 'error',
        progress: undefined,
        error: errorMessage(error),
        message: 'Could not download the update.',
      })
    }
  }

  private registerUpdaterEvents(): void {
    this.updater.on('checking-for-update', () => {
      this.setState({
        phase: 'checking',
        error: undefined,
        progress: undefined,
        message: 'Checking for updates...',
        lastCheckedAt: Date.now(),
      })
    })

    this.updater.on('update-not-available', (info) => {
      this.setState({
        phase: 'not-available',
        update: toRelease(info),
        progress: undefined,
        message: 'Lobrecs Agent is up to date.',
      })
    })

    this.updater.on('update-available', (info) => {
      this.setState({
        phase: 'available',
        update: toRelease(info),
        progress: undefined,
        error: undefined,
        message: `Version ${info.version} is available.`,
      })
    })

    this.updater.on('download-progress', (progress) => {
      this.setState({
        phase: 'downloading',
        progress: toProgress(progress),
        message: 'Downloading update...',
      })
    })

    this.updater.on('update-downloaded', (event) => {
      this.setState({
        phase: 'downloaded',
        update: toRelease(event),
        progress: undefined,
        error: undefined,
        message: `Version ${event.version} is ready to install.`,
      })
    })

    this.updater.on('update-cancelled', (info) => {
      this.setState({
        phase: 'available',
        update: toRelease(info),
        progress: undefined,
        message: 'Update download was cancelled.',
      })
    })

    this.updater.on('error', (error) => {
      this.setState({
        phase: 'error',
        progress: undefined,
        error: errorMessage(error),
        message: 'The update flow failed.',
      })
    })
  }

  private setState(patch: Partial<AppUpdateState>): AppUpdateState {
    this.state = this.decorateState({
      ...this.state,
      ...patch,
      currentVersion: app.getVersion(),
      feedUrl: this.getFeedUrl(),
    })
    this.broadcast()
    return this.state
  }

  private decorateState(state: AppUpdateState): AppUpdateState {
    const busy = state.phase === 'checking' || state.phase === 'downloading'
    const usable = this.canUseUpdater()

    return {
      ...state,
      canCheck: usable && !busy,
      canDownload: usable && state.phase === 'available',
      canInstall: usable && state.phase === 'downloaded',
    }
  }

  private canUseUpdater(): boolean {
    return this.isPackaged || this.updater.forceDevUpdateConfig
  }

  private getFeedUrl(): string | undefined {
    try {
      return this.updater.getFeedURL() ?? undefined
    } catch {
      return undefined
    }
  }

  private broadcast(): void {
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(APP_UPDATE_STATUS_CHANNEL, this.state)
        }
      }
    } catch {
      // BrowserWindow is unavailable in some test contexts.
    }
  }
}

function toRelease(info: UpdateInfo | UpdateDownloadedEvent): AppUpdateRelease {
  return {
    version: info.version,
    releaseName: info.releaseName ?? undefined,
    releaseDate: info.releaseDate,
    releaseNotes: releaseNotesText(info.releaseNotes),
  }
}

function toProgress(progress: ProgressInfo): AppUpdateProgress {
  return {
    percent: finiteNumber(progress.percent),
    transferred: finiteNumber(progress.transferred),
    total: finiteNumber(progress.total),
    bytesPerSecond: finiteNumber(progress.bytesPerSecond),
  }
}

function releaseNotesText(notes: UpdateInfo['releaseNotes']): string | undefined {
  if (typeof notes === 'string') return notes
  if (!Array.isArray(notes)) return undefined

  const text = notes
    .map((note) => [note.version, note.note].filter(Boolean).join('\n'))
    .join('\n\n')
    .trim()

  return text || undefined
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMacosCodeSigningError(error: unknown): boolean {
  const msg = errorMessage(error)
  return (
    process.platform === 'darwin' &&
    (msg.includes('code failed to satisfy specified code requirement') ||
      msg.includes('did not pass validation'))
  )
}

export const appUpdateService = new AppUpdateService()
