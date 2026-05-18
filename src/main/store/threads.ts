import { randomUUID } from 'node:crypto'
import type {
  CreateThreadInput,
  ListThreadsOptions,
  Thread,
  UpdateThreadInput,
} from '../../shared/types'
import { getDb } from './db'

type ThreadRow = {
  id: string
  project_id: string
  title: string
  created_at: number
  updated_at: number
  pinned: number
  last_session_id: string | null
  archived_at: number | null
}

function rowToThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pinned: row.pinned === 1,
    lastSessionId: row.last_session_id ?? undefined,
    archivedAt: row.archived_at ?? undefined,
  }
}

function deriveThreadTitle(prompt: string): string {
  const trimmed = prompt.trim()
  if (!trimmed) return 'Untitled thread'
  return trimmed.slice(0, 60)
}

export const threadsStore = {
  list(projectId: string, opts: ListThreadsOptions = {}): Thread[] {
    const includeArchived = opts.includeArchived ?? false
    const sql = includeArchived
      ? `SELECT * FROM threads
         WHERE project_id = ?
         ORDER BY pinned DESC, updated_at DESC, created_at DESC`
      : `SELECT * FROM threads
         WHERE project_id = ? AND archived_at IS NULL
         ORDER BY pinned DESC, updated_at DESC, created_at DESC`

    const rows = getDb().prepare(sql).all(projectId) as ThreadRow[]
    return rows.map(rowToThread)
  },

  get(id: string): Thread | null {
    const row = getDb().prepare('SELECT * FROM threads WHERE id = ?').get(id) as
      | ThreadRow
      | undefined
    return row ? rowToThread(row) : null
  },

  create(data: CreateThreadInput & { id?: string; createdAt?: number }): Thread {
    const now = data.createdAt ?? nextThreadTimestamp()
    const id = data.id ?? randomUUID()
    const title = data.title?.trim() ? data.title.trim().slice(0, 200) : 'Untitled thread'

    getDb()
      .prepare(
        `
          INSERT INTO threads (
            id, project_id, title, created_at, updated_at,
            pinned, last_session_id, archived_at
          )
          VALUES (?, ?, ?, ?, ?, 0, NULL, NULL)
        `,
      )
      .run(id, data.projectId, title, now, now)

    return requireThread(id)
  },

  update(id: string, data: UpdateThreadInput): Thread {
    const fields: string[] = []
    const values: unknown[] = []

    if (data.title !== undefined) {
      fields.push('title = ?')
      values.push(data.title.trim().slice(0, 200) || 'Untitled thread')
    }
    if (data.pinned !== undefined) {
      fields.push('pinned = ?')
      values.push(data.pinned ? 1 : 0)
    }
    if (data.lastSessionId !== undefined) {
      fields.push('last_session_id = ?')
      values.push(data.lastSessionId)
    }
    if (data.archivedAt !== undefined) {
      fields.push('archived_at = ?')
      values.push(data.archivedAt)
    }

    if (fields.length === 0) {
      return requireThread(id)
    }

    fields.push('updated_at = ?')
    values.push(nextThreadTimestamp(), id)

    getDb()
      .prepare(`UPDATE threads SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values)

    return requireThread(id)
  },

  rename(id: string, title: string): Thread {
    return threadsStore.update(id, { title })
  },

  pin(id: string, value: boolean): Thread {
    return threadsStore.update(id, { pinned: value })
  },

  archive(id: string): Thread {
    return threadsStore.update(id, { archivedAt: Date.now() })
  },

  unarchive(id: string): Thread {
    return threadsStore.update(id, { archivedAt: null })
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM threads WHERE id = ?').run(id)
  },

  linkSession(threadId: string, sessionId: string): Thread {
    const now = nextThreadTimestamp()
    getDb()
      .prepare(
        `
          UPDATE threads
          SET last_session_id = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(sessionId, now, threadId)
    return requireThread(threadId)
  },

  touch(id: string): Thread {
    getDb()
      .prepare('UPDATE threads SET updated_at = ? WHERE id = ?')
      .run(nextThreadTimestamp(), id)
    return requireThread(id)
  },

  /**
   * Idempotent migration: every session without a thread_id gets a new thread
   * built from its prompt, and is linked to it. Safe to run on every startup.
   */
  backfillFromSessions(): number {
    const db = getDb()
    const orphanRows = db
      .prepare(
        `
          SELECT id, project_id, prompt, created_at
          FROM sessions
          WHERE thread_id IS NULL
          ORDER BY created_at ASC
        `,
      )
      .all() as Array<{
      id: string
      project_id: string
      prompt: string
      created_at: number
    }>

    if (orphanRows.length === 0) return 0

    const insertThread = db.prepare(
      `
        INSERT INTO threads (
          id, project_id, title, created_at, updated_at,
          pinned, last_session_id, archived_at
        )
        VALUES (?, ?, ?, ?, ?, 0, ?, NULL)
      `,
    )
    const linkSession = db.prepare('UPDATE sessions SET thread_id = ? WHERE id = ?')

    const migrate = db.transaction((rows: typeof orphanRows) => {
      for (const row of rows) {
        const threadId = randomUUID()
        const title = deriveThreadTitle(row.prompt)
        insertThread.run(threadId, row.project_id, title, row.created_at, row.created_at, row.id)
        linkSession.run(threadId, row.id)
      }
    })

    migrate(orphanRows)
    return orphanRows.length
  },
}

function requireThread(id: string): Thread {
  const thread = threadsStore.get(id)
  if (!thread) {
    throw new Error(`Thread not found: ${id}`)
  }
  return thread
}

function nextThreadTimestamp(): number {
  const now = Date.now()
  const row = getDb()
    .prepare('SELECT MAX(updated_at) AS value FROM threads')
    .get() as { value: number | null } | undefined
  const previous = row?.value ?? 0

  return previous >= now ? previous + 1 : now
}
