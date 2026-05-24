import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  AgentId,
  ImageAttachment,
  ListThreadTranscriptOptions,
  Session,
  SessionStatus,
  SpawnedAgentSession,
  ThreadTranscriptTurn,
} from '../../shared/types'
import { getDb } from './db'
import { extractSessionOutput } from './sessionOutput'

type SessionRow = {
  id: string
  project_id: string
  agent_id: AgentId
  model: string
  prompt: string
  image_attachments: string | null
  plan_mode: number
  spawned_agent_kind: SpawnedAgentSession['kind'] | null
  spawned_agent_role: string | null
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
  imageAttachments?: ImageAttachment[] | null
  planMode?: boolean
  spawnedAgent?: SpawnedAgentSession | null
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
    imageAttachments: parseImageAttachments(row.image_attachments),
    planMode: row.plan_mode === 1,
    spawnedAgent:
      row.spawned_agent_kind && row.spawned_agent_role
        ? { kind: row.spawned_agent_kind, role: row.spawned_agent_role }
        : undefined,
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
            image_attachments, plan_mode, spawned_agent_kind, spawned_agent_role,
            tokens_in, tokens_out, cost_usd, created_at, completed_at, thread_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        data.projectId,
        data.agentId,
        data.model,
        data.prompt,
        status,
        serializeImageAttachments(data.imageAttachments),
        data.planMode ? 1 : 0,
        data.spawnedAgent?.kind ?? null,
        data.spawnedAgent?.role.trim() || null,
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

  updateModel(id: string, model: string): Session {
    getDb().prepare('UPDATE sessions SET model = ? WHERE id = ?').run(model, id)

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

    return rows.reverse().map((row) => {
      const session = rowToSession(row)
      return {
        sessionId: session.id,
        threadId,
        prompt: session.prompt,
        imageAttachments: session.imageAttachments,
        assistantText: extractSessionOutput(sessionsStore.listEvents(row.id), {
          maxChars: MAX_ASSISTANT_TRANSCRIPT_CHARS,
        }),
        status: session.status,
        createdAt: session.createdAt,
        completedAt: session.completedAt,
      }
    })
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

function serializeImageAttachments(
  imageAttachments: ImageAttachment[] | null | undefined,
): string | null {
  if (!imageAttachments || imageAttachments.length === 0) return null
  return JSON.stringify(imageAttachments)
}

function parseImageAttachments(value: string | null): ImageAttachment[] | undefined {
  if (!value) return undefined

  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return undefined

    const attachments = parsed.filter(isImageAttachment)
    return attachments.length > 0 ? attachments : undefined
  } catch {
    return undefined
  }
}

function isImageAttachment(value: unknown): value is ImageAttachment {
  if (!value || typeof value !== 'object') return false

  const record = value as Record<string, unknown>
  return (
    typeof record.filePath === 'string' &&
    (!('name' in record) || record.name === undefined || typeof record.name === 'string') &&
    (!('mimeType' in record) ||
      record.mimeType === undefined ||
      typeof record.mimeType === 'string') &&
    (!('size' in record) || record.size === undefined || typeof record.size === 'number')
  )
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
