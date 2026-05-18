import { useMemo, useState } from 'react'
import type { SessionStatus } from '../../../shared/types'

export interface SwarmSessionSummary {
  sessionId: string
  role: string
  model: string
  status: SessionStatus | string
  worktreePath?: string | null
  diffStats?: {
    filesChanged: number
    additions: number
    deletions: number
    summary?: string
  }
}

interface Props {
  swarmId: string
  sessions: SwarmSessionSummary[]
  onAccept: (sessionId: string) => void | Promise<void>
  onMerge: (sessionIds: string[]) => void | Promise<void>
  onDiscardAll?: (sessionIds: string[]) => void | Promise<void>
}

export function SwarmResults({ swarmId, sessions, onAccept, onMerge, onDiscardAll }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{
    type: 'accept' | 'merge' | 'discard'
    sessionIds: string[]
    title: string
    detail: string
  } | null>(null)

  const selectedDoneIds = useMemo(
    () =>
      selectedIds.filter((sessionId) =>
        sessions.some((session) => session.sessionId === sessionId && session.status === 'done'),
      ),
    [selectedIds, sessions],
  )
  const lanes = useMemo(
    () => [
      {
        title: 'Running',
        sessions: sessions.filter((session) =>
          session.status === 'running' || session.status === 'awaiting-approval',
        ),
      },
      {
        title: 'Ready',
        sessions: sessions.filter((session) => session.status === 'done'),
      },
      {
        title: 'Needs attention',
        sessions: sessions.filter((session) =>
          session.status === 'error' || session.status === 'cancelled',
        ),
      },
    ],
    [sessions],
  )
  const completedCount = sessions.filter((session) => session.status === 'done').length

  function accept(sessionId: string) {
    setConfirmAction({
      type: 'accept',
      sessionIds: [sessionId],
      title: 'Apply this swarm result?',
      detail: 'This will apply the selected local session result.',
    })
  }

  function mergeSelected() {
    if (selectedDoneIds.length === 0) return
    setConfirmAction({
      type: 'merge',
      sessionIds: selectedDoneIds,
      title: 'Merge selected swarm results?',
      detail: 'The selected completed sessions will be consolidated before applying changes.',
    })
  }

  function discardAll() {
    if (!onDiscardAll) return
    setConfirmAction({
      type: 'discard',
      sessionIds: sessions.map((session) => session.sessionId),
      title: 'Discard all swarm results?',
      detail: 'No additional apply step will run for these sessions.',
    })
  }

  async function runConfirmedAction() {
    if (!confirmAction) return

    const actionKey =
      confirmAction.type === 'accept'
        ? confirmAction.sessionIds[0] ?? 'accept'
        : confirmAction.type
    setPendingAction(actionKey)
    try {
      if (confirmAction.type === 'accept') {
        const sessionId = confirmAction.sessionIds[0]
        if (!sessionId) return
        await onAccept(sessionId)
      } else if (confirmAction.type === 'merge') {
        await onMerge(confirmAction.sessionIds)
      } else {
        await onDiscardAll?.(confirmAction.sessionIds)
      }
      setConfirmAction(null)
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-zinc-950">
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-zinc-100">Swarm Results</div>
          <div className="text-xs text-zinc-500">
            {swarmId} · {completedCount}/{sessions.length} ready
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={selectedDoneIds.length === 0 || pendingAction !== null}
            onClick={() => void mergeSelected()}
          >
            Merge selected with Opus
          </button>
          {onDiscardAll ? (
            <button
              type="button"
              className="rounded border border-red-900/70 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/30 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={sessions.length === 0 || pendingAction !== null}
              onClick={() => void discardAll()}
            >
              Discard all
            </button>
          ) : null}
        </div>
      </header>

      {confirmAction ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-amber-800/70 bg-amber-950/30 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-amber-100">{confirmAction.title}</div>
            <div className="mt-1 text-xs text-amber-200/80">{confirmAction.detail}</div>
          </div>
          <button
            type="button"
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900"
            disabled={pendingAction !== null}
            onClick={() => setConfirmAction(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded border border-emerald-700 bg-emerald-950/60 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-900/70 disabled:opacity-50"
            disabled={pendingAction !== null}
            onClick={() => void runConfirmedAction()}
          >
            {pendingAction ? 'Working...' : 'Confirm'}
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {lanes.map((lane) => (
            <section key={lane.title} className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900/40">
              <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                <h3 className="text-xs font-semibold uppercase text-zinc-400">{lane.title}</h3>
                <span className="text-xs text-zinc-500">{lane.sessions.length}</span>
              </div>
              <div className="grid gap-3 p-3">
                {lane.sessions.length === 0 ? (
                  <div className="rounded border border-dashed border-zinc-800 px-3 py-6 text-center text-xs text-zinc-600">
                    No sessions
                  </div>
                ) : null}
          {lane.sessions.map((session) => {
            const isSelected = selectedIds.includes(session.sessionId)
            const canAccept = session.status === 'done'

            return (
              <article
                key={session.sessionId}
                className={`rounded-md border bg-zinc-950 p-4 ${
                  isSelected ? 'border-zinc-500' : 'border-zinc-800'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-zinc-100">{session.role}</div>
                    <div className="mt-1 truncate text-xs text-zinc-500">{session.model}</div>
                  </div>
                  <label className="flex h-6 w-6 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-zinc-100"
                      checked={isSelected}
                      disabled={!canAccept || pendingAction !== null}
                      onChange={(event) => {
                        setSelectedIds((current) =>
                          event.target.checked
                            ? [...current, session.sessionId]
                            : current.filter((id) => id !== session.sessionId),
                        )
                      }}
                      aria-label={`Select ${session.role}`}
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Status</span>
                    <span className={statusColor(session.status)}>{session.status}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Diff</span>
                    <span className="text-zinc-300">{formatDiff(session.diffStats)}</span>
                  </div>
                  {session.worktreePath ? (
                    <div className="truncate text-zinc-600" title={session.worktreePath}>
                      {session.worktreePath}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="mt-4 w-full rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!canAccept || pendingAction !== null}
                  onClick={() => void accept(session.sessionId)}
                >
                  {pendingAction === session.sessionId ? 'Applying...' : 'Accept this'}
                </button>
              </article>
            )
          })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  )
}

function formatDiff(stats: SwarmSessionSummary['diffStats']): string {
  if (!stats) return 'No diff stats'
  if (stats.summary) return stats.summary

  return `+${stats.additions} -${stats.deletions} lines, ${stats.filesChanged} ${
    stats.filesChanged === 1 ? 'file' : 'files'
  } changed`
}

function statusColor(status: string): string {
  switch (status) {
    case 'done':
      return 'text-green-400'
    case 'running':
      return 'text-blue-400'
    case 'awaiting-approval':
      return 'text-amber-400'
    case 'error':
      return 'text-red-400'
    case 'cancelled':
      return 'text-zinc-500'
    default:
      return 'text-zinc-300'
  }
}
