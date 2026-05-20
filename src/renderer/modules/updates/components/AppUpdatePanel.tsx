import type { AppUpdatePrimaryAction, AppUpdateTone } from '../domain/updateCopy'
import { createAppUpdateViewModel } from '../domain/updateCopy'
import { useAppUpdate } from '../hooks/useAppUpdate'

type AppUpdateHook = ReturnType<typeof useAppUpdate>

export function AppUpdatePanel({ compact = false }: { compact?: boolean }) {
  const update = useAppUpdate()
  return <AppUpdatePanelView compact={compact} update={update} />
}

function AppUpdatePanelView({
  compact = false,
  update,
}: {
  compact?: boolean
  update: AppUpdateHook
}) {
  const {
    state,
    actionError,
    checkForUpdates,
    downloadUpdate,
    installAndRestart,
    openReleaseUrl,
  } = update
  const viewModel = createAppUpdateViewModel(state)
  const progressPercent = state?.progress?.percent ?? 0
  const detail = actionError ?? viewModel.detail

  const runAction = (action: AppUpdatePrimaryAction) => {
    if (action === 'check') void checkForUpdates()
    else if (action === 'download') void downloadUpdate()
    else void installAndRestart()
  }

  return (
    <div
      className={`rounded-card border ${toneBorder(actionError ? 'danger' : viewModel.tone)} bg-card px-3 py-3 ${
        compact ? 'w-[min(360px,calc(100vw-24px))] shadow-2xl shadow-black/40' : ''
      }`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-card ${toneIcon(
            actionError ? 'danger' : viewModel.tone,
          )}`}
          aria-hidden="true"
        >
          <UpdateIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 text-[13px] font-semibold text-primary">
              {viewModel.title}
            </h3>
            {state?.currentVersion ? (
              <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                {state.currentVersion}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[12px] leading-5 text-muted">{detail}</p>

          {state?.phase === 'downloading' ? (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-pill bg-white/10">
                <div
                  className="h-full rounded-pill bg-accent-primary transition-[width]"
                  style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
                />
              </div>
              <div className="mt-1 text-[11px] text-muted">
                {viewModel.progressLabel ?? '0%'}
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {state?.canManualDownload ? (
              <button
                type="button"
                onClick={() => void openReleaseUrl()}
                className="rounded bg-accent-primary px-2.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-primary/85"
              >
                Get Update
              </button>
            ) : null}
            {!state?.canManualDownload && viewModel.primaryAction && viewModel.primaryLabel ? (
              <button
                type="button"
                onClick={() => runAction(viewModel.primaryAction as AppUpdatePrimaryAction)}
                disabled={viewModel.busy}
                className="rounded bg-accent-primary px-2.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-primary/85 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {viewModel.primaryLabel}
              </button>
            ) : null}
            {viewModel.secondaryAction && viewModel.secondaryLabel ? (
              <button
                type="button"
                onClick={() => runAction(viewModel.secondaryAction as AppUpdatePrimaryAction)}
                disabled={viewModel.busy}
                className="rounded border border-hairline bg-card-raised px-2.5 py-1.5 text-[12px] font-medium text-secondary transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {viewModel.secondaryLabel}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export function AppUpdateBanner() {
  const update = useAppUpdate()
  const { state } = update

  if (
    state?.phase !== 'available' &&
    state?.phase !== 'downloading' &&
    state?.phase !== 'downloaded' &&
    !state?.canManualDownload
  ) {
    return null
  }

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-50">
      <div className="pointer-events-auto">
        <AppUpdatePanelView compact update={update} />
      </div>
    </div>
  )
}

function toneBorder(tone: AppUpdateTone): string {
  if (tone === 'success') return 'border-accent-add/40'
  if (tone === 'warning') return 'border-accent-warn/40'
  if (tone === 'danger') return 'border-accent-del/40'
  return 'border-hairline'
}

function toneIcon(tone: AppUpdateTone): string {
  if (tone === 'success') return 'bg-accent-add/15 text-accent-add'
  if (tone === 'warning') return 'bg-accent-warn/15 text-accent-warn'
  if (tone === 'danger') return 'bg-accent-del/15 text-accent-del'
  return 'bg-white/5 text-secondary'
}

function UpdateIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 0 1-15.6 6.1" />
      <path d="M3 12a9 9 0 0 1 15.6-6.1" />
      <path d="M3 18h5v-5" />
      <path d="M21 6h-5v5" />
    </svg>
  )
}
