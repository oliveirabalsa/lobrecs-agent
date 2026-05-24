import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ManagedCliActionId,
  ManagedCliActionResult,
  ManagedCliStatus,
  Project,
  SupportedAgentId,
} from '../../../../shared/types'
import { AppUpdatePanel } from '../../updates'

interface CliToolsViewProps {
  isMac?: boolean
  selectedProject: Project | null
  onOpenSidebar?: () => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onClose?: () => void
}

const ACTION_ORDER: ManagedCliActionId[] = [
  'install',
  'upgrade',
  'auth-status',
  'doctor',
  'models',
]

export function CliToolsView({
  isMac = false,
  selectedProject,
  onOpenSidebar,
  sidebarCollapsed = false,
  onToggleSidebar,
  onClose,
}: CliToolsViewProps) {
  const leftInsetClass = isMac
    ? sidebarCollapsed
      ? 'pl-[70px]'
      : 'pl-[70px] md:pl-4'
    : 'pl-2 md:pl-4'

  return (
    <main className="motion-fade-up-in flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas text-primary">
      <CliToolsTopBar
        leftInsetClass={leftInsetClass}
        onOpenSidebar={onOpenSidebar}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onClose={onClose}
      />
      <CliToolsPanel selectedProject={selectedProject} />
    </main>
  )
}

function CliToolsPanel({ selectedProject }: { selectedProject: Project | null }) {
  const [runtimes, setRuntimes] = useState<ManagedCliStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [runningKey, setRunningKey] = useState<string | null>(null)
  const [result, setResult] = useState<ManagedCliActionResult | null>(null)

  const loadRuntimes = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      setRuntimes(await window.agentforge.system.listManagedCliRuntimes())
    } catch (reason) {
      setRuntimes([])
      setError(reason instanceof Error ? reason.message : 'Unable to load CLI runtimes.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRuntimes()
  }, [loadRuntimes])

  const installedCount = useMemo(
    () => runtimes.filter((runtime) => runtime.installed).length,
    [runtimes],
  )

  async function runAction(agentId: SupportedAgentId, actionId: ManagedCliActionId) {
    const key = `${agentId}:${actionId}`
    setRunningKey(key)
    setError(null)
    setResult(null)

    try {
      const nextResult = await window.agentforge.system.runManagedCliAction({
        agentId,
        actionId,
        repoPath: selectedProject?.repoPath,
      })
      setResult(nextResult)
      await loadRuntimes()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'CLI command failed.')
    } finally {
      setRunningKey(null)
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-hairline px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-primary">CLI Control</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <span>{installedCount}/{runtimes.length || 4} installed</span>
              <span className="h-1 w-1 rounded-full bg-muted/50" />
              <span className="truncate">
                {selectedProject ? selectedProject.name : 'Global runtime commands'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadRuntimes()}
            disabled={loading || Boolean(runningKey)}
            className="rounded border border-hairline bg-card px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:bg-card-raised hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3">
          {error ? (
            <div className="rounded-card border border-accent-del/30 bg-accent-del/10 px-3 py-2 text-xs text-accent-del">
              {error}
            </div>
          ) : null}

          {loading ? (
            <RuntimeSkeleton />
          ) : (
            runtimes.map((runtime) => (
              <RuntimeRow
                key={runtime.agentId}
                runtime={runtime}
                runningKey={runningKey}
                onRunAction={runAction}
              />
            ))
          )}

          {result ? <CommandResult result={result} /> : null}
        </div>

        <aside className="space-y-4">
          <AppUpdatePanel />
          <div className="rounded-card border border-hairline bg-card p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded bg-white/5 text-secondary">
                <ShieldIcon />
              </div>
              <h2 className="text-sm font-semibold text-primary">Command Guard</h2>
            </div>
            <div className="mt-3 space-y-2 text-[12px] leading-5 text-muted">
              <p>Only fixed maintenance commands are exposed from the renderer.</p>
              <p>Credentials stay in each CLI's own auth store or secure keychain.</p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}

function RuntimeRow({
  runtime,
  runningKey,
  onRunAction,
}: {
  runtime: ManagedCliStatus
  runningKey: string | null
  onRunAction: (agentId: SupportedAgentId, actionId: ManagedCliActionId) => Promise<void>
}) {
  const sortedActions = [...runtime.actions].sort(
    (a, b) => ACTION_ORDER.indexOf(a.id) - ACTION_ORDER.indexOf(b.id),
  )

  return (
    <article className="rounded-card border border-hairline bg-card/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-primary">{runtime.name}</h2>
            <StatusPill installed={runtime.installed} />
            {runtime.updateAvailable ? <UpdatePill /> : null}
          </div>
          <div className="mt-2 grid gap-1 text-[11px] text-muted sm:grid-cols-[7rem_minmax(0,1fr)]">
            <span className="text-muted/70">Command</span>
            <code className="truncate font-mono text-secondary">{runtime.command}</code>
            <span className="text-muted/70">Path</span>
            <code className="truncate font-mono text-secondary">
              {runtime.commandPath ?? (runtime.installed ? 'Resolved by shell' : 'Not found')}
            </code>
            <span className="text-muted/70">Current</span>
            <code className="truncate font-mono text-secondary">
              {runtime.version ?? (runtime.installed ? 'Unknown' : 'Not installed')}
            </code>
            <span className="text-muted/70">Latest</span>
            <code className="truncate font-mono text-secondary">
              {runtime.latestVersion ?? 'Unavailable'}
            </code>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {sortedActions.map((action) => {
            const key = `${runtime.agentId}:${action.id}`
            const running = runningKey === key
            return (
              <button
                key={action.id}
                type="button"
                onClick={() => void onRunAction(runtime.agentId, action.id)}
                disabled={!action.available || Boolean(runningKey)}
                title={
                  action.available
                    ? action.commandPreview
                    : (action.unavailableReason ?? action.commandPreview)
                }
                className={`rounded px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  action.id === 'install' && !runtime.installed
                    ? 'bg-accent-primary text-white hover:bg-accent-primary/85'
                    : 'border border-hairline bg-card-raised text-secondary hover:text-primary'
                } disabled:cursor-not-allowed disabled:opacity-45`}
              >
                {running ? 'Running' : action.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded border border-hairline/70 bg-canvas/40 p-3">
          <div className="text-[11px] font-medium uppercase text-muted">
            Install
          </div>
          <p className="mt-2 text-[12px] leading-5 text-muted">{runtime.installSummary}</p>
        </div>
        <div className="rounded border border-hairline/70 bg-canvas/40 p-3">
          <div className="text-[11px] font-medium uppercase text-muted">
            Notes
          </div>
          <div className="mt-2 space-y-1.5 text-[12px] leading-5 text-muted">
            {runtime.versionError ? <p>{runtime.versionError}</p> : null}
            {runtime.latestVersionError ? <p>{runtime.latestVersionError}</p> : null}
            {runtime.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        </div>
      </div>
    </article>
  )
}

function UpdatePill() {
  return (
    <span className="rounded bg-accent-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-primary">
      Update available
    </span>
  )
}

function StatusPill({ installed }: { installed: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        installed
          ? 'bg-accent-add/15 text-accent-add'
          : 'bg-accent-warn/15 text-accent-warn'
      }`}
    >
      {installed ? 'Installed' : 'Missing'}
    </span>
  )
}

function CommandResult({ result }: { result: ManagedCliActionResult }) {
  const hasOutput = Boolean(result.stdout || result.stderr)

  return (
    <section className="rounded-card border border-hairline bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-primary">Last Command</h2>
          <code className="mt-1 block truncate font-mono text-[11px] text-muted">
            {result.command}
          </code>
        </div>
        <span
          className={`rounded px-2 py-1 text-[11px] font-medium ${
            result.exitCode === 0
              ? 'bg-accent-add/15 text-accent-add'
              : 'bg-accent-del/15 text-accent-del'
          }`}
        >
          exit {result.exitCode ?? result.signal ?? 'unknown'}
        </span>
      </header>
      {hasOutput ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[11px] leading-5 text-secondary">
          {[result.stdout, result.stderr].filter(Boolean).join('\n\n')}
        </pre>
      ) : (
        <div className="px-4 py-5 text-[12px] text-muted">No output.</div>
      )}
    </section>
  )
}

function RuntimeSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((item) => (
        <div
          key={item}
          className="h-40 animate-pulse rounded-card border border-hairline bg-card/60"
        />
      ))}
    </div>
  )
}

function CliToolsTopBar({
  leftInsetClass,
  onOpenSidebar,
  sidebarCollapsed,
  onToggleSidebar,
  onClose,
}: {
  leftInsetClass: string
  onOpenSidebar?: () => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onClose?: () => void
}) {
  return (
    <div
      className={`drag flex h-11 shrink-0 items-center gap-1 border-b border-hairline bg-canvas ${leftInsetClass} pr-2`}
    >
      {onOpenSidebar ? (
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
          className="no-drag flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-white/5 hover:text-primary md:hidden"
        >
          <MenuIcon />
        </button>
      ) : null}
      {onToggleSidebar ? (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          title={sidebarCollapsed ? 'Show sidebar (Cmd+B)' : 'Hide sidebar (Cmd+B)'}
          className="no-drag hidden h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-white/5 hover:text-primary md:flex"
        >
          <SidebarToggleIcon collapsed={!!sidebarCollapsed} />
        </button>
      ) : null}
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close CLI control"
          title="Close CLI control (Esc)"
          className="no-drag flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-white/5 hover:text-primary"
        >
          <CloseIcon />
        </button>
      ) : null}
    </div>
  )
}

function ShieldIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  )
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      {collapsed ? <path d="M12 10l2 2-2 2" /> : <path d="M14 14l-2-2 2-2" />}
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
