import type { ReactNode } from 'react'

interface Props {
  primarySessionId: string | null
  secondarySessionId: string | null
  onSwap: () => void
  renderSession?: (sessionId: string) => ReactNode
  splitEnabled?: boolean
  onToggleSplit?: (enabled: boolean) => void
}

export function SplitView({
  primarySessionId,
  secondarySessionId,
  onSwap,
  renderSession,
  splitEnabled = Boolean(secondarySessionId),
  onToggleSplit,
}: Props) {
  const showSplit = splitEnabled && Boolean(secondarySessionId)

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-zinc-950">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-800 px-3">
        <div className="min-w-0 text-xs text-zinc-500">
          {showSplit ? 'Split comparison' : 'Single session'}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!primarySessionId || !secondarySessionId}
            onClick={onSwap}
          >
            Swap
          </button>
          {onToggleSplit ? (
            <button
              type="button"
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!secondarySessionId}
              onClick={() => onToggleSplit(!showSplit)}
            >
              {showSplit ? 'Single' : 'Split'}
            </button>
          ) : null}
        </div>
      </header>

      <div
        className={`grid min-h-0 flex-1 ${
          showSplit ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'grid-cols-1'
        }`}
      >
        <SessionPane
          label="Primary"
          sessionId={primarySessionId}
          renderSession={renderSession}
        />
        {showSplit ? (
          <SessionPane
            label="Secondary"
            sessionId={secondarySessionId}
            renderSession={renderSession}
          />
        ) : null}
      </div>
    </section>
  )
}

function SessionPane({
  label,
  sessionId,
  renderSession,
}: {
  label: string
  sessionId: string | null
  renderSession?: (sessionId: string) => ReactNode
}) {
  return (
    <div className="min-h-0 border-r border-zinc-800 last:border-r-0">
      <div className="flex h-full min-h-0 flex-col">
        <div className="h-8 shrink-0 border-b border-zinc-800 px-3 py-2 text-[11px] uppercase text-zinc-500">
          {label}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {sessionId ? (
            renderSession ? (
              renderSession(sessionId)
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                TerminalPanel mount point for {sessionId}
              </div>
            )
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-zinc-600">
              No session selected
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
