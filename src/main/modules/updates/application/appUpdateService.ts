import { app, BrowserWindow, shell } from 'electron'
import {
  APP_UPDATE_STATUS_CHANNEL,
  type AppUpdateProgress,
  type AppUpdateState,
} from '../../../../shared/types'
import {
  LOBRECS_AGENT_REPO,
  releasesPageUrl,
  type GithubReleaseAsset,
} from '../domain/githubRelease'
import {
  type CheckOutcome,
  GithubReleaseChecker,
} from './githubReleaseChecker'
import {
  type DownloadProgress,
  ManualUpdateDownloader,
} from './manualUpdateDownloader'

const AUTO_CHECK_DELAY_MS = 3_000
const RELEASES_URL = releasesPageUrl(LOBRECS_AGENT_REPO)

export interface CheckForUpdatesOptions {
  automatic?: boolean
}

interface PendingDownload {
  asset: GithubReleaseAsset
  filePath: string
  latestVersion: string
}

export class AppUpdateService {
  private state: AppUpdateState
  private checkPromise: Promise<AppUpdateState> | null = null
  private downloadPromise: Promise<AppUpdateState> | null = null
  private automaticCheckTimer: NodeJS.Timeout | null = null
  private latestOutcome: CheckOutcome | null = null
  private pendingDownload: PendingDownload | null = null

  constructor(
    private readonly checker: GithubReleaseChecker = new GithubReleaseChecker(),
    private readonly downloader: ManualUpdateDownloader = new ManualUpdateDownloader(),
    private readonly isPackaged: boolean = app.isPackaged,
  ) {
    this.state = this.decorateState({
      currentVersion: app.getVersion(),
      phase: this.canUseUpdater() ? 'idle' : 'disabled',
      message: this.canUseUpdater()
        ? undefined
        : 'Updates are available from packaged builds only.',
      feedUrl: RELEASES_URL,
      canCheck: false,
      canDownload: false,
      canInstall: false,
    })
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
    if (this.state.phase !== 'available' || !this.latestOutcome?.asset) {
      throw new Error('No update is available to download.')
    }

    this.downloadPromise = this.doDownloadUpdate(this.latestOutcome).finally(() => {
      this.downloadPromise = null
    })

    return this.downloadPromise
  }

  async installDownloadedUpdate(): Promise<void> {
    if (this.state.phase !== 'downloaded' || !this.pendingDownload) {
      throw new Error('No downloaded update is ready to install.')
    }

    await this.downloader.openInstaller(this.pendingDownload.filePath)
    app.quit()
  }

  async openReleaseUrl(): Promise<void> {
    await shell.openExternal(this.latestOutcome?.releaseUrl ?? RELEASES_URL)
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
      const outcome = await this.checker.checkLatest()
      this.latestOutcome = outcome

      if (!outcome.hasUpdate) {
        return this.setState({
          phase: 'not-available',
          update: {
            version: outcome.latestVersion,
            releaseDate: outcome.publishedAt,
            releaseNotes: outcome.releaseNotes,
          },
          message: 'Lobrecs Agent is up to date.',
        })
      }

      if (!outcome.asset) {
        return this.setState({
          phase: 'error',
          error: undefined,
          progress: undefined,
          update: {
            version: outcome.latestVersion,
            releaseDate: outcome.publishedAt,
            releaseNotes: outcome.releaseNotes,
          },
          message:
            'A new release is available, but no installer is published for your platform yet.',
          canManualDownload: true,
          releaseUrl: outcome.releaseUrl,
        })
      }

      return this.setState({
        phase: 'available',
        update: {
          version: outcome.latestVersion,
          releaseDate: outcome.publishedAt,
          releaseNotes: outcome.releaseNotes,
        },
        message: `Version ${outcome.latestVersion} is available.`,
      })
    } catch (error) {
      return this.setState({
        phase: 'error',
        progress: undefined,
        error: errorMessage(error),
        message: 'Could not check for updates.',
        canManualDownload: true,
        releaseUrl: RELEASES_URL,
      })
    }
  }

  private async doDownloadUpdate(outcome: CheckOutcome): Promise<AppUpdateState> {
    if (!outcome.asset) {
      return this.setState({
        phase: 'error',
        progress: undefined,
        error: 'No installer asset available for your platform.',
        message: 'No installer asset available for your platform.',
        canManualDownload: true,
        releaseUrl: outcome.releaseUrl,
      })
    }

    this.setState({
      phase: 'downloading',
      error: undefined,
      progress: {
        percent: 0,
        transferred: 0,
        total: outcome.asset.size,
        bytesPerSecond: 0,
      },
      message: 'Downloading update...',
    })

    try {
      const result = await this.downloader.download(outcome.asset, (progress) => {
        this.setState({
          phase: 'downloading',
          progress: toAppProgress(progress),
          message: 'Downloading update...',
        })
      })

      this.pendingDownload = {
        asset: outcome.asset,
        filePath: result.filePath,
        latestVersion: outcome.latestVersion,
      }

      return this.setState({
        phase: 'downloaded',
        progress: undefined,
        message: `Version ${outcome.latestVersion} is ready to install.`,
      })
    } catch (error) {
      return this.setState({
        phase: 'error',
        progress: undefined,
        error: errorMessage(error),
        message: 'Could not download the update.',
        canManualDownload: true,
        releaseUrl: outcome.releaseUrl,
      })
    }
  }

  private setState(patch: Partial<AppUpdateState>): AppUpdateState {
    this.state = this.decorateState({
      ...this.state,
      ...patch,
      currentVersion: app.getVersion(),
      feedUrl: RELEASES_URL,
    })
    this.broadcast()
    return this.state
  }

  private decorateState(state: AppUpdateState): AppUpdateState {
    const busy = state.phase === 'checking' || state.phase === 'downloading'
    const usable = this.canUseUpdater()
    const canManualDownload =
      state.phase === 'error' ? state.canManualDownload : undefined

    return {
      ...state,
      canCheck: usable && !busy,
      canDownload: usable && state.phase === 'available',
      canInstall: usable && state.phase === 'downloaded',
      canManualDownload,
      releaseUrl: canManualDownload ? state.releaseUrl : undefined,
    }
  }

  private canUseUpdater(): boolean {
    return this.isPackaged || process.env.LOBRECS_AGENT_FORCE_DEV_UPDATE === '1'
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

function toAppProgress(progress: DownloadProgress): AppUpdateProgress {
  return {
    percent: finiteNumber(progress.percent),
    transferred: finiteNumber(progress.transferred),
    total: finiteNumber(progress.total),
    bytesPerSecond: finiteNumber(progress.bytesPerSecond),
  }
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const appUpdateService = new AppUpdateService()
