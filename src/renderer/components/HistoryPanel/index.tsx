import { format, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useEffect, useMemo, useState } from 'react'
import type { ModelTier, Session, SessionStatus } from '../../../shared/types'
import { usePersistentBoolean } from '../../hooks/usePersistentBoolean'

interface Props {
  projectId: string
  activeSessionId: string | null
  onOpenSession: (session: Session) => void
  onFork: (sessionId: string) => void
}

const STATUS_STYLES: Record<SessionStatus, string> = {
  running: 'border-blue-500/40 bg-blue-500/10 text-blue-200',
  'awaiting-approval': 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  done: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  error: 'border-red-500/40 bg-red-500/10 text-red-200',
  cancelled: 'border-zinc-600 bg-zinc-800 text-zinc-300',
}

function tierFromModel(model: string): ModelTier {
  if (model.includes('haiku') || model.includes('minimax')) return 'lightweight'
  if (model.includes('opus') || model.includes('gpt-5.5')) return 'frontier'
  if (model.includes('gpt-5.4')) return 'advanced'
  return 'balanced'
}

function formatCost(value: number) {
  return `$${value.toFixed(4)}`
}

function formatDuration(session: Session) {
  if (!session.completedAt) return 'running'
  const seconds = Math.max(0, Math.round((session.completedAt - session.createdAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

export function HistoryPanel({ projectId, activeSessionId, onOpenSession, onFork }: Props) {
  const [collapsed, setCollapsed] = usePersistentBoolean('lobrecs-agent.history-collapsed', false)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<SessionStatus | 'all'>('all')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    window.agentforge.sessions
      .list(projectId)
      .then((loadedSessions) => {
        if (cancelled) return
        setSessions([...loadedSessions].sort((a, b) => b.createdAt - a.createdAt))
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Failed to load history')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [projectId])

  const content = useMemo(() => {
    if (loading) {
      return <div className="px-3 py-3 text-xs text-zinc-500">Loading history...</div>
    }

    if (error) {
      return (
        <div className="m-2 rounded-md border border-red-900/70 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )
    }

    if (sessions.length === 0) {
      return (
        <div className="m-2 rounded-md border border-dashed border-zinc-800 px-3 py-4 text-xs leading-5 text-zinc-500">
          No sessions yet. Completed tasks will appear here.
        </div>
      )
    }

    const filteredSessions = sessions.filter((session) => {
      const matchesStatus = statusFilter === 'all' || session.status === statusFilter
      const normalizedQuery = query.trim().toLowerCase()
      const matchesQuery =
        !normalizedQuery ||
        session.prompt.toLowerCase().includes(normalizedQuery) ||
        session.model.toLowerCase().includes(normalizedQuery)

      return matchesStatus && matchesQuery
    })

    if (filteredSessions.length === 0) {
      return (
        <div className="m-2 rounded-md border border-dashed border-zinc-800 px-3 py-4 text-xs leading-5 text-zinc-500">
          No sessions match the current filter.
        </div>
      )
    }

    return filteredSessions.map((session) => {
      const active = session.id === activeSessionId
      const tier = tierFromModel(session.model)

      return (
        <div
          key={session.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpenSession(session)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onOpenSession(session)
            }
          }}
          className={`mb-1 block w-full rounded-md px-3 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 ${
            active ? 'bg-zinc-800' : 'hover:bg-zinc-900'
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-medium text-zinc-100">{session.prompt}</span>
            <span className={`ml-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${STATUS_STYLES[session.status]}`}>
              {session.status}
            </span>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-zinc-500">
            <span className="truncate">{session.model}</span>
            <span className="shrink-0">{tier}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
            <span title={formatDistanceToNow(new Date(session.createdAt), { addSuffix: true, locale: ptBR })}>
              {format(new Date(session.createdAt), 'dd/MM HH:mm', { locale: ptBR })}
            </span>
            <span>{formatDuration(session)}</span>
            <span className="ml-auto">{formatCost(session.costUsd)}</span>
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onFork(session.id)
              }}
              className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              Fork
            </button>
          </div>
        </div>
      )
    })
  }, [activeSessionId, error, loading, onFork, onOpenSession, query, sessions, statusFilter])

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-l border-zinc-800 bg-zinc-950 py-3">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-800"
          aria-label="Open history"
          title="Open history"
        >
          H
        </button>
      </aside>
    )
  }

  return (
    <aside className="hidden w-[280px] shrink-0 flex-col border-l border-zinc-800 bg-zinc-950 lg:flex">
      <div className="flex min-h-12 items-center gap-2 border-b border-zinc-800 px-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-zinc-100">History</div>
          <div className="truncate text-xs text-zinc-500">{sessions.length} sessions</div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Hide
        </button>
      </div>
      <div className="border-b border-zinc-800 p-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-blue-500"
          placeholder="Search sessions"
          aria-label="Search sessions"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          {(['all', 'running', 'awaiting-approval', 'done', 'error'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`rounded px-2 py-1 text-[11px] ${
                statusFilter === status
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
              }`}
            >
              {status === 'awaiting-approval' ? 'review' : status}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">{content}</div>
    </aside>
  )
}
