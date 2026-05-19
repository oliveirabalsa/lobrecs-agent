import { useEffect, useMemo, useState } from 'react'
import type { ModelTier, Project, RoutingDecision, Session, SessionStatus } from '../../../shared/types'

interface Props {
  project: Project
  sessionId: string | null
  prompt: string
  status: SessionStatus | null
  routingDecision: RoutingDecision | null
  modelOverride?: string
  onCancel: (sessionId: string) => void
  onFork: (sessionId: string) => void
  onFeedback: (sessionId: string, outcome: 'success' | 'failure' | 'partial', note?: string) => void
}

const STATUS_STYLES: Record<SessionStatus | 'idle', string> = {
  idle: 'border-zinc-700 bg-zinc-900 text-zinc-400',
  running: 'border-blue-500/40 bg-blue-500/10 text-blue-200',
  'awaiting-approval': 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  'awaiting-input': 'border-blue-500/40 bg-blue-500/10 text-blue-200',
  done: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  error: 'border-red-500/40 bg-red-500/10 text-red-200',
  cancelled: 'border-zinc-600 bg-zinc-800 text-zinc-300',
}

function formatCost(value: number | undefined) {
  if (!value) return '~$0.000'
  return `~$${value.toFixed(4)}`
}

function tierFromModel(model: string | undefined, fallback: ModelTier | undefined): ModelTier {
  if (fallback) return fallback
  if (!model) return 'balanced'
  if (model.includes('haiku') || model.includes('minimax') || model.includes('spark')) return 'lightweight'
  if (model.includes('opus') || model.includes('gpt-5.5')) return 'frontier'
  if (model.includes('gpt-5.4')) return 'advanced'
  return 'balanced'
}

function compactPrompt(prompt: string) {
  return prompt.trim() || 'No prompt yet'
}

export function SessionHeader({
  project,
  sessionId,
  prompt,
  status,
  routingDecision,
  modelOverride,
  onCancel,
  onFork,
  onFeedback,
}: Props) {
  const [session, setSession] = useState<Session | null>(null)
  const [feedbackNote, setFeedbackNote] = useState('')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackSaved, setFeedbackSaved] = useState<string | null>(null)

  useEffect(() => {
    setSession(null)
    setFeedbackOpen(false)
    setFeedbackSaved(null)
    setFeedbackNote('')

    if (!sessionId) return

    let cancelled = false
    window.agentforge.sessions
      .get(sessionId)
      .then((loadedSession) => {
        if (!cancelled) setSession(loadedSession)
      })
      .catch(() => {
        if (!cancelled) setSession(null)
      })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  const effectiveStatus = status ?? session?.status ?? 'idle'
  const effectivePrompt = compactPrompt(prompt || session?.prompt || '')
  const effectiveModel = modelOverride || routingDecision?.model || session?.model || project.modelTier
  const tier = tierFromModel(modelOverride || session?.model, routingDecision?.tier ?? project.modelTier)
  const cost = formatCost(session?.costUsd)

  const canCancel =
    sessionId &&
    (effectiveStatus === 'running' ||
      effectiveStatus === 'awaiting-approval' ||
      effectiveStatus === 'awaiting-input')
  const canFork = sessionId && (effectiveStatus === 'done' || effectiveStatus === 'error')

  const statusLabel = useMemo(() => {
    if (effectiveStatus === 'awaiting-approval') return 'awaiting approval'
    if (effectiveStatus === 'awaiting-input') return 'awaiting answer'
    return effectiveStatus
  }, [effectiveStatus])

  function saveFeedback(outcome: 'success' | 'failure' | 'partial', note?: string) {
    if (!sessionId) return
    onFeedback(sessionId, outcome, note)
    setFeedbackSaved(outcome)
    setFeedbackOpen(false)
  }

  return (
    <header className="flex min-h-16 items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-sm font-semibold text-zinc-100">{project.name}</h1>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[effectiveStatus]}`}>
            {statusLabel}
          </span>
          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300">
            {tier}
          </span>
        </div>

        <div className="mt-1 line-clamp-2 max-w-4xl text-xs leading-4 text-zinc-500">
          {effectivePrompt}
        </div>
      </div>

      <div className="hidden min-w-[180px] text-right text-xs text-zinc-500 md:block">
        <div className="truncate text-zinc-300">{effectiveModel}</div>
        <div>{cost}</div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {effectiveStatus === 'done' && sessionId ? (
          <div className="hidden items-center gap-1 lg:flex">
            {feedbackSaved ? (
              <span className="text-xs text-zinc-500">Feedback saved: {feedbackSaved}</span>
            ) : feedbackOpen ? (
              <>
                <input
                  value={feedbackNote}
                  onChange={(event) => setFeedbackNote(event.target.value)}
                  className="h-8 w-44 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none focus:border-blue-500"
                  placeholder="Optional note"
                />
                <button
                  type="button"
                  onClick={() => saveFeedback('failure', feedbackNote.trim() || undefined)}
                  className="rounded-md border border-red-800 px-2.5 py-1.5 text-xs text-red-200 hover:bg-red-950/60"
                >
                  Save
                </button>
              </>
            ) : (
              <>
                <span className="text-xs text-zinc-500">Useful?</span>
                <button
                  type="button"
                  onClick={() => saveFeedback('success')}
                  className="rounded-md border border-emerald-800 px-2.5 py-1.5 text-xs text-emerald-200 hover:bg-emerald-950/60"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setFeedbackOpen(true)}
                  className="rounded-md border border-red-800 px-2.5 py-1.5 text-xs text-red-200 hover:bg-red-950/60"
                >
                  No
                </button>
              </>
            )}
          </div>
        ) : null}

        {canCancel ? (
          <button
            type="button"
            onClick={() => onCancel(sessionId)}
            className="rounded-md border border-red-900 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-950/70"
          >
            Cancel
          </button>
        ) : null}

        {canFork ? (
          <button
            type="button"
            onClick={() => onFork(sessionId)}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Fork
          </button>
        ) : null}

        <span className="hidden rounded border border-zinc-800 px-2 py-1 text-[11px] text-zinc-500 xl:inline">
          Approve Cmd+Shift+A
        </span>
      </div>
    </header>
  )
}
