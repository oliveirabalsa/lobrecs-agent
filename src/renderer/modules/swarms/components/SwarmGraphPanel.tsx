import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  AgentActivity,
  AgentEvent,
  Project,
  Session,
  SessionStatus,
} from '../../../../shared/types'
import { Button, Pill } from '../../../components/ui'
import { buildSwarmGraph, type SwarmGraphNode } from '../domain/swarmGraph'

interface SwarmGraphPanelProps {
  project: Project
  threadId: string | null
  activeSessionId: string | null
  activeSessionStatus: SessionStatus | null
  onOpenSession: (session: Session) => void | Promise<void>
  onPauseSession: (sessionId: string) => void | Promise<void>
  onResumeWithEdit: (prompt: string, node: SwarmGraphNode) => void | Promise<void>
}

interface ActivityPreview {
  id: string
  label: string
  detail: string
  tone: 'neutral' | 'success' | 'warn' | 'danger' | 'info'
  timestamp: number
}

export function SwarmGraphPanel({
  project,
  threadId,
  activeSessionId,
  activeSessionStatus,
  onOpenSession,
  onPauseSession,
  onResumeWithEdit,
}: SwarmGraphPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [eventsBySession, setEventsBySession] = useState<Map<string, AgentEvent[]>>(new Map())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<'pause' | 'resume' | null>(null)

  const reload = useCallback(async () => {
    if (!threadId) {
      setSessions([])
      setEventsBySession(new Map())
      return
    }

    setLoading(true)
    try {
      const threadSessions = (await window.agentforge.sessions.list(project.id))
        .filter((session) => session.threadId === threadId)
        .sort((a, b) => a.createdAt - b.createdAt)
      const eventEntries = await Promise.all(
        threadSessions.map(async (session) => [
          session.id,
          await window.agentforge.sessions.listEvents(session.id).catch(() => []),
        ] as const),
      )

      setSessions(threadSessions)
      setEventsBySession(new Map(eventEntries))
    } finally {
      setLoading(false)
    }
  }, [project.id, threadId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!threadId) return

    const unsubscribeThread = window.agentforge.threads.onUpdated((event) => {
      if (event.thread.id === threadId) void reload()
    })

    return unsubscribeThread
  }, [reload, threadId])

  useEffect(() => {
    const unsubscribers = sessions.map((session) =>
      window.agentforge.on(`session:${session.id}`, (event) => {
        setEventsBySession((current) => {
          const next = new Map(current)
          next.set(session.id, [...(next.get(session.id) ?? []), event])
          return next
        })
        const status = statusFromEvent(event)
        if (status) {
          setSessions((current) =>
            current.map((item) =>
              item.id === session.id
                ? {
                    ...item,
                    status,
                    completedAt:
                      status === 'done' || status === 'error' || status === 'cancelled'
                        ? event.timestamp
                        : item.completedAt,
                  }
                : item,
            ),
          )
        }
      }),
    )

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [sessions])

  const graph = useMemo(
    () =>
      buildSwarmGraph(sessions, eventsBySession, {
        sessionId: activeSessionId,
        status: activeSessionStatus,
      }),
    [activeSessionId, activeSessionStatus, eventsBySession, sessions],
  )

  const selectedNode = useMemo(() => {
    if (selectedNodeId) {
      const selected = graph.nodes.find((node) => node.id === selectedNodeId)
      if (selected) return selected
    }
    return graph.nodes.find((node) => node.id === activeSessionId) ?? graph.nodes.at(-1) ?? null
  }, [activeSessionId, graph.nodes, selectedNodeId])

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedNode?.id) ?? null,
    [selectedNode?.id, sessions],
  )
  const selectedEvents = selectedNode ? eventsBySession.get(selectedNode.id) ?? [] : []
  const activityPreview = useMemo(() => buildActivityPreview(selectedEvents), [selectedEvents])

  useEffect(() => {
    if (!selectedNode) {
      setSelectedNodeId(null)
      setDraft('')
      return
    }

    setSelectedNodeId(selectedNode.id)
    setDraft(
      selectedNode.outputDraft ||
        selectedNode.outputPreview ||
        selectedNode.inputPreview ||
        `Continue from ${selectedNode.role}.`,
    )
  }, [selectedNode?.id])

  const canPauseSelected = selectedNode ? isBlockingStatus(selectedNode.status) : false
  const canResume = Boolean(selectedNode && draft.trim() && graph.activeCount === 0)

  function selectNode(node: SwarmGraphNode) {
    setSelectedNodeId(node.id)
    const session = sessions.find((item) => item.id === node.id)
    if (session) void onOpenSession(session)
  }

  async function pauseSelected() {
    if (!selectedNode || !canPauseSelected) return
    setBusyAction('pause')
    setActionError(null)
    try {
      await onPauseSession(selectedNode.id)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to pause agent')
    } finally {
      setBusyAction(null)
    }
  }

  async function resumeWithEdit() {
    if (!selectedNode || !canResume) return
    setBusyAction('resume')
    setActionError(null)
    try {
      await onResumeWithEdit(draft.trim(), selectedNode)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to resume swarm')
    } finally {
      setBusyAction(null)
    }
  }

  if (!threadId) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-muted">
        No thread selected.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="shrink-0 border-b border-hairline px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-primary">Swarm Graph</div>
            <div className="mt-1 flex min-w-0 flex-wrap gap-1.5">
              <Pill tone="info">{graph.nodes.length} agents</Pill>
              <Pill tone="success">{graph.completedCount} done</Pill>
              {graph.activeCount > 0 ? <Pill tone="warn">{graph.activeCount} active</Pill> : null}
              {graph.attentionCount > 0 ? (
                <Pill tone="danger">{graph.attentionCount} attention</Pill>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted">
            {selectedNode ? (
              <span className="hidden sm:inline">
                {selectedNode.agentLabel} / {selectedNode.model}
              </span>
            ) : null}
            {loading ? <span>Syncing</span> : null}
          </div>
        </div>
      </header>

      {graph.nodes.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="rounded-card border border-dashed border-hairline px-4 py-8 text-center text-[12px] text-muted">
            No sessions in this thread yet.
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(360px,0.9fr)_minmax(460px,1.1fr)]">
          <section className="min-h-0 overflow-y-auto border-b border-hairline px-3 py-3 xl:border-b-0 xl:border-r">
            <div className="grid gap-2">
              <RunSummary graph={graph} />
              <div className="grid gap-0">
                {graph.nodes.map((node, index) => (
                  <GraphNodeRow
                    key={node.id}
                    node={node}
                    selected={node.id === selectedNode?.id}
                    active={node.id === activeSessionId}
                    edge={index > 0 ? graph.edges[index - 1] : null}
                    onSelect={() => selectNode(node)}
                  />
                ))}
              </div>
            </div>
          </section>

          <AgentWorkspaceInspector
            node={selectedNode}
            session={selectedSession}
            events={activityPreview}
            draft={draft}
            actionError={actionError}
            canPause={canPauseSelected}
            canResume={canResume}
            busyAction={busyAction}
            onDraftChange={setDraft}
            onPause={() => void pauseSelected()}
            onResume={() => void resumeWithEdit()}
          />
        </div>
      )}
    </div>
  )
}

function RunSummary({ graph }: { graph: ReturnType<typeof buildSwarmGraph> }) {
  const totalEvents = graph.nodes.reduce((total, node) => total + node.eventCount, 0)
  const fileChanges = graph.nodes.reduce((total, node) => total + node.fileChangeCount, 0)
  const commands = graph.nodes.reduce((total, node) => total + node.commandCount, 0)

  return (
    <div className="grid grid-cols-3 gap-2">
      <MetricCard label="Activity" value={totalEvents} />
      <MetricCard label="Commands" value={commands} />
      <MetricCard label="Files" value={fileChanges} />
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-hairline bg-card/60 px-3 py-2">
      <div className="text-[10px] font-medium uppercase text-muted">{label}</div>
      <div className="mt-1 text-[16px] font-semibold tabular-nums text-primary">{value}</div>
    </div>
  )
}

function GraphNodeRow({
  node,
  edge,
  selected,
  active,
  onSelect,
}: {
  node: SwarmGraphNode
  edge: { label: string; preview: string } | null
  selected: boolean
  active: boolean
  onSelect: () => void
}) {
  return (
    <div className="relative min-w-0">
      {edge ? (
        <div className="ml-[18px] flex min-h-8 items-center gap-2 border-l border-hairline pl-4">
          <span className="h-px w-5 shrink-0 bg-hairline" />
          <div className="min-w-0 py-1">
            <div className="text-[10px] font-medium uppercase text-muted">{edge.label}</div>
            {edge.preview ? (
              <div className="mt-0.5 truncate text-[11px] text-muted/80">{edge.preview}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onSelect}
        className={`grid w-full grid-cols-[40px_minmax(0,1fr)] gap-3 rounded-card border px-3 py-3 text-left transition-colors ${
          selected
            ? 'border-accent-primary/60 bg-accent-primary/10 shadow-[0_0_0_1px_rgba(137,164,255,0.18)]'
            : 'border-hairline bg-card hover:border-white/15 hover:bg-card-raised'
        }`}
      >
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-card border text-[12px] font-semibold ${
            active
              ? 'border-accent-primary/50 bg-accent-primary/15 text-accent-primary'
              : selected
                ? 'border-accent-primary/40 bg-canvas text-accent-primary'
                : 'border-hairline bg-canvas text-secondary'
          }`}
        >
          {node.index + 1}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0 truncate text-[13px] font-semibold text-primary">
              {node.role}
            </div>
            <StatusPill status={node.status} />
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
            <span className="truncate">{node.agentLabel} / {node.model}</span>
            {node.durationMs !== null ? <span>{formatDuration(node.durationMs)}</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <TinyStat label="msg" value={node.messageCount} />
            <TinyStat label="cmd" value={node.commandCount} />
            <TinyStat label="files" value={node.fileChangeCount} />
          </div>
          {node.outputPreview || node.inputPreview ? (
            <div className="mt-2 line-clamp-2 break-words text-[11px] leading-4 text-secondary">
              {node.outputPreview || node.inputPreview}
            </div>
          ) : null}
        </div>
      </button>
    </div>
  )
}

function TinyStat({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded border border-hairline bg-canvas px-1.5 py-0.5 text-[10px] text-muted">
      {value} {label}
    </span>
  )
}

function AgentWorkspaceInspector({
  node,
  session,
  events,
  draft,
  actionError,
  canPause,
  canResume,
  busyAction,
  onDraftChange,
  onPause,
  onResume,
}: {
  node: SwarmGraphNode | null
  session: Session | null
  events: ActivityPreview[]
  draft: string
  actionError: string | null
  canPause: boolean
  canResume: boolean
  busyAction: 'pause' | 'resume' | null
  onDraftChange: (value: string) => void
  onPause: () => void
  onResume: () => void
}) {
  if (!node) {
    return (
      <section className="flex min-h-0 items-center justify-center px-6 text-center text-[12px] text-muted">
        Select an agent node.
      </section>
    )
  }

  return (
    <section className="flex min-h-0 flex-col overflow-hidden bg-card/20">
      <div className="shrink-0 border-b border-hairline px-4 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-primary">{node.role}</div>
            <div className="mt-0.5 truncate text-[11px] text-muted">
              {node.agentLabel} / {node.model}
            </div>
          </div>
          <StatusPill status={node.status} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MetricCard label="Events" value={node.eventCount} />
          <MetricCard label="Input" value={node.tokensIn} />
          <MetricCard label="Output" value={node.tokensOut} />
          <MetricCard label="Cost" value={Math.round(node.costUsd * 1000) / 1000} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="grid gap-3">
          <WorkspaceBlock title="Prompt">
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-secondary">
              {session?.prompt ?? node.inputPreview}
            </pre>
          </WorkspaceBlock>

          <WorkspaceBlock title="Activity">
            {events.length > 0 ? (
              <div className="grid gap-2">
                {events.map((event) => (
                  <ActivityRow key={event.id} event={event} />
                ))}
              </div>
            ) : (
              <div className="rounded-card border border-dashed border-hairline px-3 py-5 text-center text-[11px] text-muted">
                No activity captured yet.
              </div>
            )}
          </WorkspaceBlock>

          <WorkspaceBlock title="Handoff">
            <textarea
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              className="min-h-32 w-full resize-y rounded-card border border-hairline bg-canvas px-3 py-2 text-[12px] leading-5 text-secondary outline-none placeholder:text-muted/70 focus:border-accent-primary/60"
              placeholder="Edit the handoff..."
              aria-label="Edited swarm handoff"
            />
          </WorkspaceBlock>

          {actionError ? (
            <div className="rounded-card border border-accent-del/30 bg-accent-del/10 px-3 py-2 text-[11px] text-accent-del">
              {actionError}
            </div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-hairline px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="chip"
            disabled={!canPause || busyAction !== null}
            loading={busyAction === 'pause'}
            onClick={onPause}
          >
            Pause current
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!canResume || busyAction !== null}
            loading={busyAction === 'resume'}
            onClick={onResume}
          >
            Resume with edit
          </Button>
        </div>
      </div>
    </section>
  )
}

function WorkspaceBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-hairline bg-card/65 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase text-muted">{title}</div>
      {children}
    </section>
  )
}

function ActivityRow({ event }: { event: ActivityPreview }) {
  return (
    <div className="grid grid-cols-[10px_minmax(0,1fr)] gap-2 rounded-card border border-hairline bg-canvas px-3 py-2">
      <span className={`mt-1.5 h-2 w-2 rounded-full ${dotClassForTone(event.tone)}`} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="truncate text-[11px] font-semibold text-primary">{event.label}</div>
          <div className="shrink-0 text-[10px] text-muted tabular-nums">
            {formatClock(event.timestamp)}
          </div>
        </div>
        {event.detail ? (
          <div className="mt-1 line-clamp-3 break-words text-[11px] leading-4 text-secondary">
            {event.detail}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: SessionStatus }) {
  return <Pill tone={toneForStatus(status)}>{statusLabel(status)}</Pill>
}

function toneForStatus(status: SessionStatus): 'neutral' | 'success' | 'warn' | 'danger' | 'info' {
  switch (status) {
    case 'done':
      return 'success'
    case 'running':
      return 'info'
    case 'awaiting-approval':
    case 'awaiting-input':
      return 'warn'
    case 'error':
    case 'cancelled':
      return 'danger'
  }
}

function statusLabel(status: SessionStatus): string {
  if (status === 'awaiting-approval') return 'approval'
  if (status === 'awaiting-input') return 'input'
  return status
}

function isBlockingStatus(status: SessionStatus): boolean {
  return status === 'running' || status === 'awaiting-approval' || status === 'awaiting-input'
}

function statusFromEvent(event: AgentEvent): SessionStatus | null {
  if (event.type === 'approval-request') return 'awaiting-approval'
  if (event.type === 'error') return 'error'
  if (event.type !== 'session-complete') return null

  if (event.payload && typeof event.payload === 'object') {
    const status = (event.payload as { status?: unknown }).status
    if (isSessionStatus(status)) return status
  }

  return 'done'
}

function buildActivityPreview(events: readonly AgentEvent[]): ActivityPreview[] {
  return events.slice(-24).reverse().map((event, index) => {
    const activity = event.type === 'activity' && isAgentActivity(event.payload)
      ? event.payload
      : null
    const baseId = `${event.sessionId}:${event.timestamp}:${index}`

    if (activity) {
      return {
        id: baseId,
        timestamp: event.timestamp,
        ...activityPreviewFromActivity(activity),
      }
    }

    if (event.type === 'approval-request') {
      return {
        id: baseId,
        label: 'Approval requested',
        detail: textFromUnknown(event.payload),
        tone: 'warn',
        timestamp: event.timestamp,
      }
    }

    if (event.type === 'diff') {
      return {
        id: baseId,
        label: 'Diff received',
        detail: textFromUnknown(event.payload, 'Code changes applied'),
        tone: 'info',
        timestamp: event.timestamp,
      }
    }

    if (event.type === 'error') {
      return {
        id: baseId,
        label: 'Error',
        detail: textFromUnknown(event.payload),
        tone: 'danger',
        timestamp: event.timestamp,
      }
    }

    return {
      id: baseId,
      label: event.type === 'session-complete' ? 'Completed' : event.type,
      detail: textFromUnknown(event.payload),
      tone: event.type === 'session-complete' ? 'success' : 'neutral',
      timestamp: event.timestamp,
    }
  })
}

function activityPreviewFromActivity(
  activity: AgentActivity,
): Omit<ActivityPreview, 'id' | 'timestamp'> {
  switch (activity.kind) {
    case 'message':
      return { label: 'Message', detail: activity.text, tone: 'info' }
    case 'step':
      return {
        label: activity.title,
        detail: activity.detail ?? activity.status,
        tone: toneFromActivityStatus(activity.status),
      }
    case 'tool-call':
      return {
        label: `Tool: ${activity.name}`,
        detail: activity.status,
        tone: toneFromActivityStatus(activity.status),
      }
    case 'tool-result':
      return {
        label: `${activity.name} result`,
        detail: activity.output ?? activity.status,
        tone: toneFromActivityStatus(activity.status),
      }
    case 'command':
      return {
        label: 'Command',
        detail: activity.command,
        tone: toneFromActivityStatus(activity.status),
      }
    case 'file-change':
      return {
        label: `${activity.changeType} file`,
        detail: activity.filePath,
        tone: activity.status === 'conflict' || activity.status === 'rejected' ? 'danger' : 'info',
      }
    case 'approval':
      return { label: 'Approval', detail: activity.status, tone: 'warn' }
    case 'diff-summary':
      return {
        label: `${activity.filesChanged} files changed`,
        detail: activity.summary,
        tone: 'info',
      }
    case 'completion':
      return {
        label: 'Completion',
        detail: activity.summary,
        tone: toneForStatus(activity.status),
      }
    case 'compaction':
      return { label: 'Compaction', detail: 'Context compacted', tone: 'neutral' }
    case 'plan-prompt':
      return { label: activity.title, detail: `${activity.options.length} options`, tone: 'warn' }
    case 'plan-review':
      return { label: 'Plan ready', detail: `${activity.agentId} / ${activity.model}`, tone: 'warn' }
    case 'user-question':
      return { label: activity.title, detail: `${activity.questions.length} questions`, tone: 'warn' }
    case 'swarm-step-approval':
      return {
        label: 'Step approval',
        detail: `${activity.completedRole} -> ${activity.nextRole}`,
        tone: 'warn',
      }
    case 'model-recovery':
      return {
        label: 'Model recovery',
        detail: `${activity.failedAgentId} / ${activity.failedModel}`,
        tone: 'warn',
      }
  }
}

function toneFromActivityStatus(status: 'pending' | 'running' | 'done' | 'error') {
  if (status === 'done') return 'success'
  if (status === 'error') return 'danger'
  if (status === 'running') return 'info'
  return 'neutral'
}

function textFromUnknown(payload: unknown, fallback = ''): string {
  if (typeof payload === 'string') return payload
  if (!payload || typeof payload !== 'object') return fallback

  const value = payload as Record<string, unknown>
  for (const key of ['text', 'message', 'summary', 'error', 'output', 'status']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }

  return fallback
}

function isAgentActivity(payload: unknown): payload is AgentActivity {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'kind' in payload &&
    typeof (payload as { kind?: unknown }).kind === 'string'
  )
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return (
    value === 'running' ||
    value === 'awaiting-approval' ||
    value === 'awaiting-input' ||
    value === 'done' ||
    value === 'error' ||
    value === 'cancelled'
  )
}

function dotClassForTone(tone: ActivityPreview['tone']): string {
  switch (tone) {
    case 'success':
      return 'bg-accent-add'
    case 'warn':
      return 'bg-accent-warn'
    case 'danger':
      return 'bg-accent-del'
    case 'info':
      return 'bg-accent-primary'
    case 'neutral':
      return 'bg-muted'
  }
}

function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return '<1s'
  const seconds = Math.round(ms / 1_000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.round(minutes / 60)}h`
}
