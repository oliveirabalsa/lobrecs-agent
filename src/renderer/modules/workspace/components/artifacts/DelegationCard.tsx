import { useEffect, useMemo, useState } from 'react'
import type { AgentActivity, AgentEvent, DiffProposal } from '../../../../../shared/types'
import { Modal } from '../../../../components/ui'
import { EditedFilesCard, type EditedFilesCardProps } from './EditedFilesCard'

export type DelegationActivity = Extract<AgentActivity, { kind: 'delegation' }>

export interface DelegationCardProps {
  delegation: DelegationActivity
}

export function DelegationCard({ delegation }: DelegationCardProps) {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const done = delegation.status === 'done'
  const failed = delegation.status === 'error' || delegation.status === 'cancelled'
  const body = delegation.summary ?? delegation.error ?? delegation.lastOutput
  const eventRows = useMemo(() => events.map(eventRow), [events])
  const editedFiles = useMemo(() => editedFilesFromEvents(events), [events])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setLoadingEvents(true)
    setEventsError(null)

    window.agentforge.sessions
      .listEvents(delegation.childSessionId)
      .then((list) => {
        if (!cancelled) setEvents(list)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setEventsError(
            error instanceof Error ? error.message : 'Failed to load background agent events',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingEvents(false)
      })

    const unsubscribe = window.agentforge.on(
      `session:${delegation.childSessionId}`,
      (event) => {
        setEvents((current) => appendEvent(current, event))
      },
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [delegation.childSessionId, open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`self-start w-full max-w-[min(620px,100%)] overflow-hidden rounded-card border bg-card text-left transition-colors hover:bg-card-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary/70 ${
          failed
            ? 'border-accent-del/35'
            : done
              ? 'border-accent-add/30'
              : 'border-accent-primary/30'
        }`}
      >
        <header className="flex items-center gap-3 border-b border-hairline bg-card-raised px-3 py-2.5">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-card border ${
              failed
                ? 'border-accent-del/35 bg-accent-del/10 text-accent-del'
                : done
                  ? 'border-accent-add/35 bg-accent-add/10 text-accent-add'
                  : 'border-accent-primary/35 bg-accent-primary/10 text-accent-primary'
            }`}
            aria-hidden="true"
          >
            {done ? iconCheck : failed ? iconAlert : iconBranch}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-primary">
                Background agent
              </span>
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  failed
                    ? 'bg-accent-del'
                    : done
                      ? 'bg-accent-add'
                      : 'animate-pulse bg-accent-primary'
                }`}
                aria-hidden="true"
              />
            </div>
            <div className="truncate text-[11px] text-muted">
              {delegation.agentId} / {delegation.model}
            </div>
          </div>
          <span className="shrink-0 rounded-pill border border-hairline bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            {delegation.status}
          </span>
        </header>

        <div className="grid gap-2 px-3 py-3">
          <div className="truncate text-xs font-medium leading-5 text-primary">
            {delegation.goal}
          </div>
          {body ? (
            <div className="truncate rounded-card border border-hairline bg-canvas px-3 py-2 text-[11px] leading-5 text-secondary">
              {body}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-card border border-hairline bg-canvas px-3 py-2 text-[11px] text-muted">
              <span
                className="h-3 w-3 shrink-0 animate-spin rounded-full border border-muted/40 border-t-accent-primary"
                aria-hidden="true"
              />
              Waiting for background agent output...
            </div>
          )}
        </div>
      </button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Background agent"
        description="Full background agent interaction"
        maxWidth={760}
      >
        <div className="grid gap-3">
          <div className="rounded-card border border-hairline bg-canvas px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Goal
            </div>
            <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-primary">
              {delegation.goal}
            </div>
          </div>

          {editedFiles.length > 0 ? (
            <EditedFilesCard proposals={[]} fallbackFiles={editedFiles} />
          ) : null}

          <div className="max-h-[min(62vh,620px)] overflow-auto rounded-card border border-hairline bg-canvas">
            {loadingEvents ? (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted">
                <span
                  className="h-3 w-3 animate-spin rounded-full border border-muted/40 border-t-accent-primary"
                  aria-hidden="true"
                />
                Loading interaction...
              </div>
            ) : eventsError ? (
              <div className="px-3 py-3 text-xs text-accent-del">{eventsError}</div>
            ) : eventRows.length > 0 ? (
              <div className="divide-y divide-hairline">
                {eventRows.map((row) => (
                  <div key={row.key} className="grid gap-1 px-3 py-2.5">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted">
                      <span>{row.type}</span>
                      <span className="tabular-nums opacity-70">{row.time}</span>
                    </div>
                    <div className="whitespace-pre-wrap break-words text-[11px] leading-5 text-secondary">
                      {row.text}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-3 py-3 text-xs text-muted">
                No interaction events recorded yet.
              </div>
            )}
          </div>
        </div>
      </Modal>
    </>
  )
}

type EditedFileFallback = NonNullable<EditedFilesCardProps['fallbackFiles']>[number]

function editedFilesFromEvents(events: readonly AgentEvent[]): EditedFileFallback[] {
  const files = new Map<string, EditedFileFallback>()

  const addFile = (file: EditedFileFallback) => {
    const existing = files.get(file.filePath)
    if (!existing) {
      files.set(file.filePath, { ...file })
      return
    }

    files.set(file.filePath, {
      filePath: file.filePath,
      changeType: file.changeType ?? existing.changeType,
      additions: (existing.additions ?? 0) + (file.additions ?? 0),
      deletions: (existing.deletions ?? 0) + (file.deletions ?? 0),
    })
  }

  for (const event of events) {
    if (event.type === 'activity' && event.payload && typeof event.payload === 'object') {
      const activity = event.payload as Partial<AgentActivity>
      if (
        activity.kind === 'file-change' &&
        typeof activity.filePath === 'string'
      ) {
        addFile({
          filePath: activity.filePath,
          changeType: activity.changeType,
          additions: activity.additions,
          deletions: activity.deletions,
        })
      }
    }

    if (event.type !== 'diff' || !Array.isArray(event.payload)) continue
    for (const item of event.payload) {
      if (!item || typeof item !== 'object') continue
      const proposal = item as Partial<DiffProposal>
      if (!proposal.filePath) continue
      addFile({
        filePath: proposal.filePath,
        changeType: proposal.changeType,
        additions: proposal.additions,
        deletions: proposal.deletions,
      })
    }
  }

  return [...files.values()]
}

function appendEvent(events: readonly AgentEvent[], event: AgentEvent): AgentEvent[] {
  const key = eventKey(event)
  if (events.some((item) => eventKey(item) === key)) return [...events]
  return [...events, event]
}

function eventKey(event: AgentEvent): string {
  return `${event.type}:${event.timestamp}:${event.sessionId}:${eventText(event).slice(0, 60)}`
}

function eventRow(event: AgentEvent): {
  key: string
  type: string
  time: string
  text: string
} {
  return {
    key: eventKey(event),
    type: event.type,
    time: new Date(event.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    text: eventText(event),
  }
}

function eventText(event: AgentEvent): string {
  if (event.type === 'activity') return activityText(event.payload)
  if (event.type === 'session-complete') {
    const status = payloadRecord(event.payload).status
    return `Session completed${typeof status === 'string' ? `: ${status}` : ''}`
  }
  if (event.type === 'error') {
    const message = payloadRecord(event.payload).message
    return typeof message === 'string' ? message : 'Background agent failed.'
  }

  return unknownText(event.payload)
}

function activityText(payload: unknown): string {
  const activity = payload as Partial<AgentActivity> | null
  if (!activity || typeof activity !== 'object') return unknownText(payload)

  switch (activity.kind) {
    case 'message':
      return activity.text ?? ''
    case 'step':
      return [activity.title, activity.detail].filter(Boolean).join('\n')
    case 'tool-call':
      return `Running ${activity.name ?? 'tool'}`
    case 'tool-result':
      return activity.output ?? `${activity.name ?? 'Tool'} finished`
    case 'command':
      return activity.command ?? ''
    case 'file-change':
      return `${activity.changeType ?? 'changed'} ${activity.filePath ?? ''}`.trim()
    case 'completion':
      return activity.summary ?? String(activity.status ?? 'complete')
    default:
      return unknownText(payload)
  }
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

function unknownText(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    for (const key of ['text', 'message', 'summary', 'output']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value
    }
  }

  try {
    return JSON.stringify(payload ?? null, null, 2)
  } catch {
    return String(payload)
  }
}

const iconBranch = (
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
    <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="18" r="3" />
    <path d="M9 6h3a6 6 0 0 1 6 6v3" />
    <path d="M6 9v9" />
  </svg>
)

const iconCheck = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m5 12 4 4L19 6" />
  </svg>
)

const iconAlert = (
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
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
)
