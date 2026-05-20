import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
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
  onPauseSession: (sessionId: string) => void | Promise<void>
  onResumeWithEdit: (prompt: string, node: SwarmGraphNode) => void | Promise<void>
}

export function SwarmGraphPanel({
  project,
  threadId,
  activeSessionId,
  activeSessionStatus,
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
        <div className="flex items-center justify-between gap-3">
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
          {loading ? <span className="text-[11px] text-muted">Syncing</span> : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {graph.nodes.length === 0 ? (
          <div className="rounded-card border border-dashed border-hairline px-4 py-8 text-center text-[12px] text-muted">
            No sessions in this thread yet.
          </div>
        ) : (
          <div className="grid gap-0">
            {graph.nodes.map((node, index) => (
              <GraphNodeRow
                key={node.id}
                node={node}
                selected={node.id === selectedNode?.id}
                active={node.id === activeSessionId}
                edge={index > 0 ? graph.edges[index - 1] : null}
                onSelect={() => setSelectedNodeId(node.id)}
              />
            ))}
          </div>
        )}
      </div>

      <section className="shrink-0 border-t border-hairline bg-card/40 px-3 py-3">
        {selectedNode ? (
          <div className="grid gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-primary">
                  {selectedNode.role}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted">
                  {selectedNode.agentLabel} / {selectedNode.model}
                </div>
              </div>
              <StatusPill status={selectedNode.status} />
            </div>

            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-24 resize-y rounded-card border border-hairline bg-canvas px-3 py-2 text-[12px] leading-5 text-secondary outline-none placeholder:text-muted/70 focus:border-accent-primary/60"
              placeholder="Edit the handoff..."
              aria-label="Edited swarm handoff"
            />

            {actionError ? (
              <div className="rounded-card border border-accent-del/30 bg-accent-del/10 px-3 py-2 text-[11px] text-accent-del">
                {actionError}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="chip"
                disabled={!canPauseSelected || busyAction !== null}
                loading={busyAction === 'pause'}
                onClick={() => void pauseSelected()}
              >
                Pause current
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!canResume || busyAction !== null}
                loading={busyAction === 'resume'}
                onClick={() => void resumeWithEdit()}
              >
                Resume with edit
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-[12px] text-muted">Select an agent node.</div>
        )}
      </section>
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
    <div className="relative">
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
        className={`grid w-full grid-cols-[36px_minmax(0,1fr)] gap-3 rounded-card border px-3 py-3 text-left transition-colors ${
          selected
            ? 'border-accent-primary/50 bg-accent-primary/10'
            : 'border-hairline bg-card hover:bg-card-raised'
        }`}
      >
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-card border text-[12px] font-semibold ${
            active
              ? 'border-accent-primary/50 bg-accent-primary/15 text-accent-primary'
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
          <div className="mt-1 truncate text-[11px] text-muted">
            {node.agentLabel} / {node.model}
          </div>
          {node.outputPreview || node.inputPreview ? (
            <div className="mt-2 line-clamp-2 text-[11px] leading-4 text-secondary">
              {node.outputPreview || node.inputPreview}
            </div>
          ) : null}
        </div>
      </button>
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
