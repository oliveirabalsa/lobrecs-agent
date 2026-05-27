import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentEvent, Session, SessionStatus } from '../../../../shared/types'
import { Button, Modal, Pill, Spinner } from '../../../components/ui'
import {
  backgroundAgentPreviewState,
  ACTIVE_BACKGROUND_AGENT_STATUSES,
  BACKGROUND_AGENT_PREVIEW_LIMIT,
  backgroundAgentStatusFromEvent,
  backgroundAgentWaitMessage,
  canStopBackgroundAgentSession,
  latestBackgroundAgentSessions,
  latestBackgroundAgentUserQuestion,
  summarizeBackgroundAgentSessions,
  type BackgroundAgentSession,
  type BackgroundAgentSummary,
  type BackgroundAgentUserQuestion,
} from '../lib/backgroundAgents'
import { deriveTimedSessionActivities } from '../hooks/useSessionEvents'
import { MessageStream } from './MessageStream'

interface BackgroundAgentsCardProps {
  projectId: string
  threadId: string | null | undefined
  refreshKey?: number
  onBlockingChange?: (blocking: BackgroundAgentsBlockingState | null) => void
  onUserQuestion?: (question: BackgroundAgentUserQuestion | null) => void
}

export interface BackgroundAgentsBlockingState {
  summary: BackgroundAgentSummary
  message: string
}

export function BackgroundAgentsCard({
  projectId,
  threadId,
  refreshKey,
  onBlockingChange,
  onUserQuestion,
}: BackgroundAgentsCardProps) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [eventsBySession, setEventsBySession] = useState<Map<string, AgentEvent[]>>(new Map())
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [cancellingSessionIds, setCancellingSessionIds] = useState<Set<string>>(new Set())

  const reload = useCallback(async () => {
    if (!threadId) {
      setSessions([])
      setEventsBySession(new Map())
      setActionError(null)
      setCancellingSessionIds(new Set())
      return
    }

    setLoading(true)
    try {
      const list = await window.agentforge.sessions.list(projectId)
      const backgroundSessions = latestBackgroundAgentSessions(list, threadId)
      const eventEntries = await Promise.all(
        backgroundSessions.map(async (session) => [
          session.id,
          await window.agentforge.sessions.listEvents(session.id).catch(() => []),
        ] as const),
      )

      setSessions(list)
      setEventsBySession(new Map(eventEntries))
    } finally {
      setLoading(false)
    }
  }, [projectId, threadId])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  useEffect(() => {
    if (!threadId) return
    return window.agentforge.threads.onUpdated((event) => {
      if (event.thread.id === threadId) void reload()
    })
  }, [reload, threadId])

  useEffect(() => {
    setShowAll(false)
  }, [threadId])

  const handleCancelSession = useCallback(async (sessionId: string) => {
    setActionError(null)
    setCancellingSessionIds((current) => new Set(current).add(sessionId))

    try {
      await window.agentforge.agent.cancel(sessionId)
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                status: 'cancelled',
                completedAt: Date.now(),
              }
            : session,
        ),
      )
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to stop background agent')
    } finally {
      setCancellingSessionIds((current) => {
        const next = new Set(current)
        next.delete(sessionId)
        return next
      })
    }
  }, [])

  const backgroundSessions = useMemo(
    () => latestBackgroundAgentSessions(sessions, threadId),
    [sessions, threadId],
  )

  useEffect(() => {
    const unsubscribers = backgroundSessions.map((session) =>
      window.agentforge.on(`session:${session.id}`, (event) => {
        setEventsBySession((current) => {
          const next = new Map(current)
          next.set(session.id, appendEvent(next.get(session.id) ?? [], event))
          return next
        })

        const status = backgroundAgentStatusFromEvent(event)
        if (!status) return
        setSessions((current) =>
          current.map((item) =>
            item.id === session.id
              ? {
                  ...item,
                  status,
                  completedAt: ACTIVE_BACKGROUND_AGENT_STATUSES.has(status)
                    ? item.completedAt
                    : event.timestamp,
                }
              : item,
          ),
        )
      }),
    )

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [backgroundSessions])

  const selectedSession =
    backgroundSessions.find((session) => session.id === selectedSessionId) ??
    backgroundSessions.at(-1) ??
    null
  const selectedEvents = selectedSession ? eventsBySession.get(selectedSession.id) ?? [] : []
  const selectedTimedActivities = useMemo(
    () => deriveTimedSessionActivities(selectedEvents),
    [selectedEvents],
  )
  const summary = useMemo(
    () => summarizeBackgroundAgentSessions(backgroundSessions),
    [backgroundSessions],
  )
  const waitMessage = useMemo(
    () => backgroundAgentWaitMessage(backgroundSessions),
    [backgroundSessions],
  )
  const pendingUserQuestion = useMemo(
    () => latestBackgroundAgentUserQuestion(backgroundSessions, eventsBySession),
    [backgroundSessions, eventsBySession],
  )
  const preview = useMemo(
    () =>
      backgroundAgentPreviewState(
        backgroundSessions,
        showAll,
        BACKGROUND_AGENT_PREVIEW_LIMIT,
      ),
    [backgroundSessions, showAll],
  )

  useEffect(() => {
    if (!onBlockingChange) return
    if (!waitMessage || summary.active === 0) {
      onBlockingChange(null)
      return
    }

    onBlockingChange({ summary, message: waitMessage })
    return () => onBlockingChange(null)
  }, [onBlockingChange, summary, waitMessage])

  useEffect(() => {
    if (!onUserQuestion) return
    onUserQuestion(pendingUserQuestion)
  }, [onUserQuestion, pendingUserQuestion])

  if (!threadId || backgroundSessions.length === 0) return null

  return (
    <>
      <section
        className="self-start w-full max-w-[min(680px,100%)] overflow-hidden rounded-card border border-accent-primary/30 bg-card text-left shadow-elevated transition-colors hover:bg-card-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary/70"
      >
        <button
          type="button"
          onClick={() => setSelectedSessionId(backgroundSessions.at(-1)?.id ?? null)}
          className="flex w-full items-center gap-3 border-b border-hairline bg-card-raised px-4 py-3 text-left transition-colors hover:bg-card"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-accent-primary/30 bg-accent-primary/15 text-accent-primary">
            {loading ? <Spinner size={12} /> : iconAgents}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[13px] font-semibold text-primary">
                Background agents
              </span>
              {summary.active > 0 ? <Pill tone="info">{summary.active} running</Pill> : null}
              {summary.failed > 0 ? <Pill tone="danger">{summary.failed} attention</Pill> : null}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted">
              Last execution: {summary.done}/{backgroundSessions.length} finished
            </div>
          </div>
          <span className="shrink-0 rounded-pill border border-hairline bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Open
          </span>
        </button>

        <div className="grid gap-2 px-4 py-3">
          {waitMessage ? (
            <div className="rounded-card border border-accent-primary/25 bg-accent-primary/10 px-3 py-2 text-xs font-medium leading-5 text-accent-primary">
              {waitMessage}
            </div>
          ) : null}
          {actionError ? (
            <div className="rounded-card border border-accent-del/35 bg-accent-del/10 px-3 py-2 text-xs leading-5 text-accent-del">
              {actionError}
            </div>
          ) : null}
          {preview.visibleSessions.map((session) => (
            <BackgroundAgentRow
              key={session.id}
              session={session}
              selected={session.id === selectedSessionId}
              onSelect={() => setSelectedSessionId(session.id)}
              cancelling={cancellingSessionIds.has(session.id)}
              onCancel={() => void handleCancelSession(session.id)}
            />
          ))}
          {preview.overLimit ? (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="self-start rounded px-1 py-0.5 text-[10px] text-muted transition-colors hover:text-primary"
            >
              {showAll ? 'Show less' : `Show more (${preview.hiddenCount})`}
            </button>
          ) : null}
        </div>
      </section>

      <Modal
        open={selectedSessionId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedSessionId(null)
        }}
        title="Background agent output"
        description={selectedSession ? selectedSession.spawnedAgent.role : undefined}
        maxWidth={860}
      >
        {selectedSession ? (
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${statusDotClass(selectedSession.status)}`} />
                <span className="rounded-pill border border-hairline bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {statusLabel(selectedSession.status)}
                </span>
              </div>
              <div className="mt-1 truncate text-[11px] text-muted">
                {selectedSession.agentId} / {selectedSession.model}
              </div>
            </div>
            {canStopBackgroundAgentSession(selectedSession) ? (
              <Button
                variant="ghost"
                size="sm"
                loading={cancellingSessionIds.has(selectedSession.id)}
                disabled={cancellingSessionIds.has(selectedSession.id)}
                onClick={() => void handleCancelSession(selectedSession.id)}
                className="shrink-0 border border-accent-del/35 bg-accent-del/10 text-accent-del hover:bg-accent-del/15 hover:text-accent-del"
              >
                Stop agent
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="max-h-[min(72vh,720px)] overflow-y-auto rounded-card border border-hairline bg-canvas px-3 py-4">
          {selectedSession ? (
            <MessageStream
              activities={selectedTimedActivities.map(({ activity }) => activity)}
              activityTimes={selectedTimedActivities.map(({ at }) => at)}
              sessionId={selectedSession.id}
              loading={loading}
              running={ACTIVE_BACKGROUND_AGENT_STATUSES.has(selectedSession.status)}
              showAssistantActions={false}
            />
          ) : (
            <div className="px-3 py-4 text-center text-xs text-muted">
              No background output selected.
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}

function BackgroundAgentRow({
  session,
  selected,
  onSelect,
  cancelling,
  onCancel,
}: {
  session: BackgroundAgentSession
  selected: boolean
  onSelect: () => void
  cancelling: boolean
  onCancel: () => void
}) {
  const canCancel = canStopBackgroundAgentSession(session)

  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={onSelect}
        className={`grid min-w-0 flex-1 grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 rounded-card border px-3 py-2 text-left transition-colors hover:bg-card-raised ${
          selected ? 'border-accent-primary/45 bg-accent-primary/10' : 'border-hairline bg-canvas'
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${statusDotClass(session.status)}`} />
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-primary">
            {session.spawnedAgent.role}
          </div>
          <div className="truncate text-[11px] text-muted">
            {session.agentId} / {session.model}
          </div>
        </div>
        <span className="rounded-pill border border-hairline bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
          {statusLabel(session.status)}
        </span>
      </button>
      {canCancel ? (
        <Button
          variant="ghost"
          size="sm"
          loading={cancelling}
          disabled={cancelling}
          onClick={() => onCancel()}
          className="shrink-0 border border-accent-del/35 bg-accent-del/10 text-accent-del hover:bg-accent-del/15 hover:text-accent-del"
        >
          Stop
        </Button>
      ) : null}
    </div>
  )
}

function appendEvent(events: readonly AgentEvent[], event: AgentEvent): AgentEvent[] {
  const key = `${event.type}:${event.timestamp}:${event.sessionId}:${JSON.stringify(event.payload).slice(0, 80)}`
  if (events.some((item) => `${item.type}:${item.timestamp}:${item.sessionId}:${JSON.stringify(item.payload).slice(0, 80)}` === key)) {
    return [...events]
  }
  return [...events, event]
}

function statusDotClass(status: SessionStatus): string {
  if (status === 'done') return 'bg-accent-add'
  if (status === 'error') return 'bg-accent-del'
  if (status === 'cancelled') return 'bg-muted'
  return 'bg-accent-primary animate-pulse'
}

function statusLabel(status: SessionStatus): string {
  if (status === 'awaiting-approval') return 'approval'
  if (status === 'awaiting-input') return 'input'
  return status
}

const iconAgents = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M16 18h4a2 2 0 0 0 2-2v-1a4 4 0 0 0-4-4h-1" />
    <path d="M8 18H4a2 2 0 0 1-2-2v-1a4 4 0 0 1 4-4h1" />
    <circle cx="12" cy="7" r="4" />
    <path d="M8 22a4 4 0 0 1 8 0" />
  </svg>
)
