export const APP_UPDATE_STATUS_CHANNEL = 'updates:status'

export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled'

export interface AppUpdateRelease {
  version: string
  releaseName?: string
  releaseDate?: string
  releaseNotes?: string
}

export interface AppUpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface AppUpdateState {
  currentVersion: string
  phase: AppUpdatePhase
  canCheck: boolean
  canDownload: boolean
  canInstall: boolean
  update?: AppUpdateRelease
  progress?: AppUpdateProgress
  error?: string
  message?: string
  feedUrl?: string
  lastCheckedAt?: number
}
