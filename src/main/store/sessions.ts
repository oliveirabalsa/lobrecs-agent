import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  AgentId,
  ListThreadTranscriptOptions,
  Session,
  SessionStatus,
  ThreadTranscriptTurn,
} from '../../shared/types'
import { getDb } from './db'

type SessionRow = {
  id: string
  project_id: string
  agent_id: AgentId
  model: string
  prompt: string
  status: SessionStatus
  tokens_in: number
  tokens_out: number
  cost_usd: number
  created_at: number
  completed_at: number | null
  thread_id: string | null
}

type SessionEventRow = {
  id: number
  session_id: string
  event_type: AgentEvent['type']
  payload: string
  created_at: number
}

export type CreateSessionInput = {
  id?: string
  projectId: string
  agentId: AgentId
  model: string
  prompt: string
  status?: SessionStatus
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
  createdAt?: number
  completedAt?: number | null
  threadId?: string | null
}

const terminalStatuses = new Set<SessionStatus>(['done', 'error', 'cancelled'])
const DEFAULT_THREAD_TRANSCRIPT_LIMIT = 6
const MAX_THREAD_TRANSCRIPT_LIMIT = 12
const MAX_ASSISTANT_TRANSCRIPT_CHARS = 6_000

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    projectId: row.project_id,
    threadId: row.thread_id ?? undefined,
    agentId: row.agent_id,
    model: row.model,
    prompt: row.prompt,
    status: row.status,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  }
}

export const sessionsStore = {
  list(projectId: string): Session[] {
    const rows = getDb()
      .prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as SessionRow[]

    return rows.map(rowToSession)
  },

  get(id: string): Session | null {
    const row = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | SessionRow
      | undefined

    return row ? rowToSession(row) : null
  },

  create(data: CreateSessionInput): Session {
    const now = data.createdAt ?? Date.now()
    const id = data.id ?? randomUUID()
    const status = data.status ?? 'running'
    const completedAt =
      data.completedAt !== undefined
        ? data.completedAt
        : terminalStatuses.has(status)
          ? now
          : null

    getDb()
      .prepare(
        `
          INSERT INTO sessions (
            id, project_id, agent_id, model, prompt, status,
            tokens_in, tokens_out, cost_usd, created_at, completed_at, thread_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        data.projectId,
        data.agentId,
        data.model,
        data.prompt,
        status,
        data.tokensIn ?? 0,
        data.tokensOut ?? 0,
        data.costUsd ?? 0,
        now,
        completedAt,
        data.threadId ?? null,
      )

    return requireSession(id)
  },

  updateStatus(id: string, status: SessionStatus, completedAt?: number | null): Session {
    const nextCompletedAt =
      completedAt !== undefined
        ? completedAt
        : terminalStatuses.has(status)
          ? Date.now()
          : null

    getDb()
      .prepare('UPDATE sessions SET status = ?, completed_at = ? WHERE id = ?')
      .run(status, nextCompletedAt, id)

    return requireSession(id)
  },

  updateUsage(id: string, tokensIn: number, tokensOut: number, costUsd: number): Session {
    getDb()
      .prepare('UPDATE sessions SET tokens_in = ?, tokens_out = ?, cost_usd = ? WHERE id = ?')
      .run(tokensIn, tokensOut, costUsd, id)

    return requireSession(id)
  },

  cancelInterrupted(): number {
    const result = getDb()
      .prepare(
        `
          UPDATE sessions
          SET status = 'cancelled', completed_at = ?
          WHERE status IN ('running', 'awaiting-approval')
        `,
      )
      .run(Date.now())

    return result.changes
  },

  addEvent(event: AgentEvent): void {
    getDb()
      .prepare(
        `
          INSERT INTO session_events (session_id, event_type, payload, created_at)
          VALUES (?, ?, ?, ?)
        `,
      )
      .run(event.sessionId, event.type, JSON.stringify(event.payload ?? null), event.timestamp)
  },

  listEvents(sessionId: string): AgentEvent[] {
    const rows = getDb()
      .prepare('SELECT * FROM session_events WHERE session_id = ? ORDER BY id ASC')
      .all(sessionId) as SessionEventRow[]

    return rows.map((row) => ({
      type: row.event_type,
      sessionId: row.session_id,
      payload: JSON.parse(row.payload) as unknown,
      timestamp: row.created_at,
    }))
  },

  listThreadTranscript(
    threadId: string,
    options: ListThreadTranscriptOptions = {},
  ): ThreadTranscriptTurn[] {
    const limit = normalizeTranscriptLimit(options.limit)
    const params: unknown[] = [threadId]
    const excludeSession = options.excludeSessionId?.trim()
    const excludeSql = excludeSession ? 'AND id != ?' : ''

    if (excludeSession) {
      params.push(excludeSession)
    }
    params.push(limit)

    const rows = getDb()
      .prepare(
        `
          SELECT *
          FROM sessions
          WHERE thread_id = ?
          ${excludeSql}
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(...params) as SessionRow[]

    return rows.reverse().map((row) => ({
      sessionId: row.id,
      threadId,
      prompt: row.prompt,
      assistantText: extractAssistantText(sessionsStore.listEvents(row.id)),
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    }))
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id)
  },

  getForkPayload(id: string): { prompt: string; agentId: AgentId; model: string } | null {
    const session = this.get(id)
    if (!session) return null

    return {
      prompt: session.prompt,
      agentId: session.agentId,
      model: session.model,
    }
  },

  getThreadId(id: string): string | null {
    const row = getDb().prepare('SELECT thread_id FROM sessions WHERE id = ?').get(id) as
      | { thread_id: string | null }
      | undefined
    return row?.thread_id ?? null
  },

  linkToThread(sessionId: string, threadId: string): void {
    getDb().prepare('UPDATE sessions SET thread_id = ? WHERE id = ?').run(threadId, sessionId)
  },
}

function requireSession(id: string): Session {
  const session = sessionsStore.get(id)
  if (!session) {
    throw new Error(`Session not found: ${id}`)
  }

  return session
}

function normalizeTranscriptLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_THREAD_TRANSCRIPT_LIMIT

  return Math.min(Math.max(Math.floor(limit), 1), MAX_THREAD_TRANSCRIPT_LIMIT)
}

function extractAssistantText(events: AgentEvent[]): string | undefined {
  const activityMessages = events.flatMap(assistantMessagesFromActivity)
  const preferred = lastNonEmpty(activityMessages)
  if (preferred) return truncateTranscriptText(preferred, MAX_ASSISTANT_TRANSCRIPT_CHARS)

  const stdoutMessages = events
    .filter((event) => event.type === 'stdout')
    .map((event) => textFromPayload(event.payload))
  const fallback = lastNonEmpty(stdoutMessages)

  return fallback ? truncateTranscriptText(fallback, MAX_ASSISTANT_TRANSCRIPT_CHARS) : undefined
}

function assistantMessagesFromActivity(event: AgentEvent): string[] {
  if (event.type !== 'activity' || !isRecord(event.payload)) return []

  const payload = event.payload
  if (
    payload.kind === 'message' &&
    payload.role === 'assistant' &&
    typeof payload.text === 'string'
  ) {
    return [payload.text]
  }

  return []
}

function lastNonEmpty(values: string[]): string | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const text = values[index].trim()
    if (text) return text
  }

  return undefined
}

function textFromPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (!isRecord(payload)) return ''

  for (const field of ['text', 'result', 'message', 'content', 'summary', 'output']) {
    const value = payload[field]
    if (typeof value === 'string') return value
  }

  return ''
}

function truncateTranscriptText(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed

  return `${trimmed.slice(0, maxChars).trimEnd()}\n[truncated]`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
