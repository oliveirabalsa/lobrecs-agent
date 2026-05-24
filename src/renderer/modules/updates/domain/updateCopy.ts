import type { AppUpdateState } from '../../../../shared/types'

export type AppUpdatePrimaryAction = 'check' | 'download' | 'install'
export type AppUpdateTone = 'neutral' | 'success' | 'warning' | 'danger'

export interface AppUpdateViewModel {
  title: string
  detail: string
  tone: AppUpdateTone
  busy: boolean
  primaryAction?: AppUpdatePrimaryAction
  primaryLabel?: string
  secondaryAction?: AppUpdatePrimaryAction
  secondaryLabel?: string
  progressLabel?: string
}

export function createAppUpdateViewModel(state: AppUpdateState | null): AppUpdateViewModel {
  if (!state) {
    return {
      title: 'Loading update status',
      detail: 'Checking the local updater state.',
      tone: 'neutral',
      busy: true,
    }
  }

  const version = state.update?.version
  const detail = state.message ?? `Current version ${state.currentVersion}.`

  if (state.phase === 'checking') {
    return {
      title: 'Checking for updates',
      detail,
      tone: 'neutral',
      busy: true,
    }
  }

  if (state.phase === 'available') {
    return {
      title: version ? `Version ${version} is available` : 'Update available',
      detail,
      tone: 'warning',
      busy: false,
      primaryAction: 'download',
      primaryLabel: 'Download',
      secondaryAction: state.canCheck ? 'check' : undefined,
      secondaryLabel: state.canCheck ? 'Check again' : undefined,
    }
  }

  if (state.phase === 'downloading') {
    return {
      title: version ? `Downloading ${version}` : 'Downloading update',
      detail,
      tone: 'neutral',
      busy: true,
      progressLabel: formatPercent(state.progress?.percent ?? 0),
    }
  }

  if (state.phase === 'downloaded') {
    return {
      title: version ? `Version ${version} is ready` : 'Update ready',
      detail:
        state.message ??
        'Open the installer and follow the prompts to finish updating.',
      tone: 'success',
      busy: false,
      primaryAction: 'install',
      primaryLabel: 'Open installer',
    }
  }

  if (state.phase === 'not-available') {
    return {
      title: 'Lobrecs Agent is up to date',
      detail: `Current version ${state.currentVersion}.`,
      tone: 'success',
      busy: false,
      primaryAction: state.canCheck ? 'check' : undefined,
      primaryLabel: state.canCheck ? 'Check again' : undefined,
    }
  }

  if (state.phase === 'error') {
    if (state.canManualDownload) {
      return {
        title: 'Manual update required',
        detail: state.message ?? state.error ?? detail,
        tone: 'warning',
        busy: false,
      }
    }

    return {
      title: 'Update check failed',
      detail: state.error ?? detail,
      tone: 'danger',
      busy: false,
      primaryAction: state.canCheck ? 'check' : undefined,
      primaryLabel: state.canCheck ? 'Try again' : undefined,
    }
  }

  if (state.phase === 'disabled') {
    return {
      title: 'Updates unavailable in this build',
      detail,
      tone: 'warning',
      busy: false,
    }
  }

  return {
    title: `Current version ${state.currentVersion}`,
    detail,
    tone: 'neutral',
    busy: false,
    primaryAction: state.canCheck ? 'check' : undefined,
    primaryLabel: state.canCheck ? 'Check for updates' : undefined,
  }
}

function formatPercent(value: number): string {
  const percent = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
  return `${Math.round(percent)}%`
}
