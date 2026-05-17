import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentId, Session, SessionStatus } from '../../shared/types'
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
}

const terminalStatuses = new Set<SessionStatus>(['done', 'error', 'cancelled'])

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    projectId: row.project_id,
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
            tokens_in, tokens_out, cost_usd, created_at, completed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
}

function requireSession(id: string): Session {
  const session = sessionsStore.get(id)
  if (!session) {
    throw new Error(`Session not found: ${id}`)
  }

  return session
}
