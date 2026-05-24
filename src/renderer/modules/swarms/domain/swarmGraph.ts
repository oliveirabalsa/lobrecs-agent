import type { AgentActivity, AgentEvent, Session, SessionStatus } from '../../../../shared/types'

export interface SwarmGraphNode {
  id: string
  index: number
  role: string
  agentLabel: Session['agentId']
  model: string
  status: SessionStatus
  startedAt: number
  completedAt?: number
  durationMs: number | null
  tokensIn: number
  tokensOut: number
  costUsd: number
  inputPreview: string
  outputPreview: string
  outputDraft: string
  eventCount: number
  messageCount: number
  commandCount: number
  fileChangeCount: number
  approvalCount: number
}

export interface SwarmGraphEdge {
  id: string
  from: string
  to: string
  label: string
  preview: string
}

export interface SwarmGraph {
  nodes: SwarmGraphNode[]
  edges: SwarmGraphEdge[]
  completedCount: number
  activeCount: number
  attentionCount: number
}

export function buildSwarmGraph(
  sessions: readonly Session[],
  eventsBySession: ReadonlyMap<string, readonly AgentEvent[]>,
  activeOverride?: { sessionId: string | null; status: SessionStatus | null },
): SwarmGraph {
  const orderedSessions = [...sessions].sort((a, b) => a.createdAt - b.createdAt)

  const nodes = orderedSessions.map((session, index): SwarmGraphNode => {
    const events = eventsBySession.get(session.id) ?? []
    const outputDraft = latestMeaningfulOutput(events)
    const activityCounts = summarizeActivities(events)
    const status =
      activeOverride?.sessionId === session.id && activeOverride.status
        ? activeOverride.status
        : session.status
    const lastEventAt = events.at(-1)?.timestamp
    const endAt = session.completedAt ?? lastEventAt

    return {
      id: session.id,
      index,
      role: roleFromPrompt(session.prompt) ?? `agent ${index + 1}`,
      agentLabel: session.agentId,
      model: session.model,
      status,
      startedAt: session.createdAt,
      completedAt: session.completedAt,
      durationMs: endAt ? Math.max(0, endAt - session.createdAt) : null,
      tokensIn: session.tokensIn,
      tokensOut: session.tokensOut,
      costUsd: session.costUsd,
      inputPreview: preview(removeRoleHeader(session.prompt), 220),
      outputPreview: preview(outputDraft, 220),
      outputDraft,
      eventCount: events.length,
      ...activityCounts,
    }
  })

  const edges = nodes.slice(1).map((node, index): SwarmGraphEdge => {
    const previous = nodes[index]
    return {
      id: `${previous.id}->${node.id}`,
      from: previous.id,
      to: node.id,
      label: edgeLabel(previous, node),
      preview: node.inputPreview,
    }
  })

  return {
    nodes,
    edges,
    completedCount: nodes.filter((node) => node.status === 'done').length,
    activeCount: nodes.filter((node) =>
      node.status === 'running' ||
      node.status === 'awaiting-approval' ||
      node.status === 'awaiting-input',
    ).length,
    attentionCount: nodes.filter((node) => node.status === 'error' || node.status === 'cancelled')
      .length,
  }
}

export function roleFromPrompt(prompt: string): string | null {
  const match = prompt.match(/^\s*\[Role:\s*([^\]]+)\]/i)
  const role = match?.[1]?.trim()
  return role || null
}

function removeRoleHeader(prompt: string): string {
  return prompt.replace(/^\s*\[Role:\s*[^\]]+\]\s*/i, '').trim()
}

function latestMeaningfulOutput(events: readonly AgentEvent[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    const text = textFromEvent(event)
    if (text.trim()) return text.trim()
  }

  return ''
}

function textFromEvent(event: AgentEvent): string {
  if (event.type === 'stdout' || event.type === 'stderr' || event.type === 'error') {
    return textFromUnknown(event.payload)
  }

  if (event.type === 'session-complete') {
    return textFromUnknown(event.payload, 'Session complete')
  }

  if (event.type === 'diff') {
    return 'Code changes applied'
  }

  if (event.type === 'approval-request') {
    return 'Approval requested'
  }

  if (event.type === 'activity' && isAgentActivity(event.payload)) {
    return textFromActivity(event.payload)
  }

  return ''
}

function textFromActivity(activity: AgentActivity): string {
  switch (activity.kind) {
    case 'message':
      return activity.text
    case 'step':
      return [activity.title, activity.detail].filter(Boolean).join(': ')
    case 'tool-call':
      return `Using ${activity.name}`
    case 'tool-result':
      return activity.output ?? `${activity.name} completed`
    case 'command':
      return activity.command
    case 'file-change':
      return `${activity.changeType} ${activity.filePath}`
    case 'approval':
      return `Approval ${activity.status}`
    case 'diff-summary':
      return activity.summary
    case 'completion':
      return activity.summary
    case 'compaction':
      return 'Context compacted'
    case 'plan-prompt':
      return activity.title
    case 'plan-review':
      return 'Plan ready for review'
    case 'user-question':
      return activity.title
    case 'swarm-step-approval':
      return `Continue to ${activity.nextRole}?`
    case 'model-recovery':
      return `Model recovery needed: ${activity.failedAgentId} / ${activity.failedModel}`
    case 'delegation':
      return activity.summary ?? activity.lastOutput ?? `Delegated task: ${activity.goal}`
  }
}

function textFromUnknown(payload: unknown, fallback = ''): string {
  if (typeof payload === 'string') return payload
  if (!payload || typeof payload !== 'object') return fallback

  const value = payload as Record<string, unknown>
  for (const key of ['text', 'message', 'summary', 'error', 'output']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }

  if (typeof value.status === 'string') return value.status
  return fallback
}

function summarizeActivities(events: readonly AgentEvent[]) {
  const counts = {
    messageCount: 0,
    commandCount: 0,
    fileChangeCount: 0,
    approvalCount: 0,
  }

  for (const event of events) {
    if (event.type === 'approval-request') counts.approvalCount += 1
    if (event.type !== 'activity' || !isAgentActivity(event.payload)) continue

    switch (event.payload.kind) {
      case 'message':
        counts.messageCount += 1
        break
      case 'command':
        counts.commandCount += 1
        break
      case 'file-change':
      case 'diff-summary':
        counts.fileChangeCount += 1
        break
      case 'approval':
      case 'plan-review':
      case 'plan-prompt':
      case 'user-question':
      case 'swarm-step-approval':
        counts.approvalCount += 1
        break
      case 'delegation':
        counts.messageCount += 1
        break
    }
  }

  return counts
}

function edgeLabel(from: SwarmGraphNode, to: SwarmGraphNode): string {
  if (/\breview/i.test(to.role)) return 'review handoff'
  if (from.status === 'done') return 'completed output'
  if (from.status === 'awaiting-approval') return 'approval gate'
  if (from.status === 'awaiting-input') return 'input gate'
  return 'thread context'
}

function preview(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`
}

function isAgentActivity(payload: unknown): payload is AgentActivity {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'kind' in payload &&
    typeof (payload as { kind?: unknown }).kind === 'string'
  )
}
