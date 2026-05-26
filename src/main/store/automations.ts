import { randomUUID } from 'node:crypto'
import type {
  AgentId,
  Automation,
  AutomationReviewState,
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTrigger,
  AutomationStatus,
} from '../../shared/types'
import { getDb } from './db'

type AutomationRow = {
  id: string
  project_id: string
  name: string
  prompt: string
  schedule: string
  agent_id: AgentId
  enabled: 0 | 1
  last_run_at: number | null
  next_run_at: number | null
  status: AutomationStatus | null
  review_state: AutomationReviewState | null
  unread_run_count: number | null
  project_ids: string | null
  created_at: number
}

type AutomationRunRow = {
  id: string
  automation_id: string
  project_id: string
  session_id: string | null
  trigger: AutomationRunTrigger
  status: AutomationRunStatus
  review_state: AutomationReviewState
  unread: 0 | 1
  attempt: number
  error: string | null
  created_at: number
  started_at: number | null
  completed_at: number | null
}

export type CreateAutomationInput = Omit<
  Automation,
  | 'id'
  | 'createdAt'
  | 'lastRunAt'
  | 'nextRunAt'
  | 'status'
  | 'reviewState'
  | 'hasUnreadRuns'
  | 'unreadRunCount'
> & {
  id?: string
  createdAt?: number
  lastRunAt?: number | null
  nextRunAt?: number | null
  status?: AutomationStatus
  reviewState?: AutomationReviewState
  unreadRunCount?: number
}

export type UpdateAutomationInput = Partial<
  Omit<Automation, 'id' | 'createdAt' | 'hasUnreadRuns' | 'nextRunAt'>
> & {
  nextRunAt?: number | null
}

export type CreateAutomationRunInput = {
  id?: string
  automationId: string
  projectId: string
  sessionId?: string | null
  trigger: AutomationRunTrigger
  status: AutomationRunStatus
  reviewState?: AutomationReviewState
  unread?: boolean
  attempt?: number
  error?: string | null
  createdAt?: number
  startedAt?: number | null
  completedAt?: number | null
}

export type UpdateAutomationRunInput = Partial<
  Pick<AutomationRun, 'sessionId' | 'status' | 'reviewState' | 'unread' | 'attempt' | 'startedAt' | 'completedAt'>
> & {
  error?: string | null
}

function rowToAutomation(row: AutomationRow): Automation {
  const unreadRunCount = row.unread_run_count ?? 0
  return {
    id: row.id,
    projectId: row.project_id,
    projectIds: parseProjectIds(row.project_ids),
    name: row.name,
    prompt: row.prompt,
    schedule: row.schedule,
    agentId: row.agent_id,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    status: row.status ?? (row.enabled === 1 ? 'scheduled' : 'paused'),
    reviewState: row.review_state ?? 'reviewed',
    hasUnreadRuns: unreadRunCount > 0,
    unreadRunCount,
    createdAt: row.created_at,
  }
}

function rowToAutomationRun(row: AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    projectId: row.project_id,
    sessionId: row.session_id ?? undefined,
    trigger: row.trigger,
    status: row.status,
    reviewState: row.review_state,
    unread: row.unread === 1,
    attempt: row.attempt,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  }
}

export const automationsStore = {
  list(projectId?: string): Automation[] {
    const rows = projectId
      ? (getDb()
          .prepare('SELECT * FROM automations WHERE project_id = ? ORDER BY created_at DESC')
          .all(projectId) as AutomationRow[])
      : (getDb()
          .prepare('SELECT * FROM automations ORDER BY created_at DESC')
          .all() as AutomationRow[])

    return rows.map(rowToAutomation)
  },

  listEnabled(): Automation[] {
    const rows = getDb()
      .prepare('SELECT * FROM automations WHERE enabled = 1 ORDER BY created_at ASC')
      .all() as AutomationRow[]

    return rows.map(rowToAutomation)
  },

  get(id: string): Automation | null {
    const row = getDb().prepare('SELECT * FROM automations WHERE id = ?').get(id) as
      | AutomationRow
      | undefined

    return row ? rowToAutomation(row) : null
  },

  create(data: CreateAutomationInput): Automation {
    const id = data.id ?? randomUUID()
    const createdAt = data.createdAt ?? Date.now()
    const reviewState = data.reviewState ?? 'reviewed'
    const unreadRunCount = data.unreadRunCount ?? 0
    const status = data.status ?? (data.enabled ? 'scheduled' : 'paused')

    getDb()
      .prepare(
        `
          INSERT INTO automations (
            id, project_id, name, prompt, schedule, agent_id, enabled, last_run_at,
            next_run_at, status, review_state, unread_run_count, project_ids, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        data.projectId,
        data.name,
        data.prompt,
        data.schedule,
        data.agentId,
        data.enabled ? 1 : 0,
        data.lastRunAt ?? null,
        data.nextRunAt ?? null,
        status,
        reviewState,
        unreadRunCount,
        serializeProjectIds(data.projectIds),
        createdAt,
      )

    return requireAutomation(id)
  },

  update(id: string, data: UpdateAutomationInput): Automation {
    const fields: string[] = []
    const values: unknown[] = []

    if (data.projectId !== undefined) {
      fields.push('project_id = ?')
      values.push(data.projectId)
    }
    if (data.name !== undefined) {
      fields.push('name = ?')
      values.push(data.name)
    }
    if (data.prompt !== undefined) {
      fields.push('prompt = ?')
      values.push(data.prompt)
    }
    if (data.schedule !== undefined) {
      fields.push('schedule = ?')
      values.push(data.schedule)
    }
    if (data.agentId !== undefined) {
      fields.push('agent_id = ?')
      values.push(data.agentId)
    }
    if (data.enabled !== undefined) {
      fields.push('enabled = ?')
      values.push(data.enabled ? 1 : 0)
    }
    if (data.lastRunAt !== undefined) {
      fields.push('last_run_at = ?')
      values.push(data.lastRunAt ?? null)
    }
    if (data.nextRunAt !== undefined) {
      fields.push('next_run_at = ?')
      values.push(data.nextRunAt ?? null)
    }
    if (data.status !== undefined) {
      fields.push('status = ?')
      values.push(data.status)
    }
    if (data.reviewState !== undefined) {
      fields.push('review_state = ?')
      values.push(data.reviewState)
    }
    if (data.unreadRunCount !== undefined) {
      fields.push('unread_run_count = ?')
      values.push(Math.max(0, data.unreadRunCount))
    }
    if (data.projectIds !== undefined) {
      fields.push('project_ids = ?')
      values.push(serializeProjectIds(data.projectIds))
    }

    if (fields.length > 0) {
      values.push(id)
      getDb()
        .prepare(`UPDATE automations SET ${fields.join(', ')} WHERE id = ?`)
        .run(...values)
    }

    return requireAutomation(id)
  },

  markRun(id: string, timestamp = Date.now()): Automation {
    getDb()
      .prepare('UPDATE automations SET last_run_at = ? WHERE id = ?')
      .run(timestamp, id)

    return requireAutomation(id)
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM automations WHERE id = ?').run(id)
  },

  listRuns(projectId: string, limit = 100): AutomationRun[] {
    const rows = getDb()
      .prepare(
        `
          SELECT *
          FROM automation_runs
          WHERE project_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `,
      )
      .all(projectId, limit) as AutomationRunRow[]

    return rows.map(rowToAutomationRun)
  },

  listRunsForAutomation(automationId: string, limit = 50): AutomationRun[] {
    const rows = getDb()
      .prepare(
        `
          SELECT *
          FROM automation_runs
          WHERE automation_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `,
      )
      .all(automationId, limit) as AutomationRunRow[]

    return rows.map(rowToAutomationRun)
  },

  getRun(id: string): AutomationRun | null {
    const row = getDb().prepare('SELECT * FROM automation_runs WHERE id = ?').get(id) as
      | AutomationRunRow
      | undefined

    return row ? rowToAutomationRun(row) : null
  },

  getRunBySessionId(sessionId: string): AutomationRun | null {
    const row = getDb()
      .prepare('SELECT * FROM automation_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(sessionId) as AutomationRunRow | undefined

    return row ? rowToAutomationRun(row) : null
  },

  getRunningRun(automationId: string): AutomationRun | null {
    const row = getDb()
      .prepare(
        `
          SELECT *
          FROM automation_runs
          WHERE automation_id = ? AND status IN ('queued', 'running')
          ORDER BY created_at DESC
          LIMIT 1
        `,
      )
      .get(automationId) as AutomationRunRow | undefined

    return row ? rowToAutomationRun(row) : null
  },

  listActiveRuns(): AutomationRun[] {
    const rows = getDb()
      .prepare(
        `
          SELECT *
          FROM automation_runs
          WHERE status IN ('queued', 'running')
          ORDER BY created_at ASC
        `,
      )
      .all() as AutomationRunRow[]

    return rows.map(rowToAutomationRun)
  },

  createRun(data: CreateAutomationRunInput): AutomationRun {
    const id = data.id ?? randomUUID()
    const createdAt = data.createdAt ?? Date.now()

    getDb()
      .prepare(
        `
          INSERT INTO automation_runs (
            id, automation_id, project_id, session_id, trigger, status, review_state,
            unread, attempt, error, created_at, started_at, completed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        data.automationId,
        data.projectId,
        data.sessionId ?? null,
        data.trigger,
        data.status,
        data.reviewState ?? 'unread',
        data.unread === false ? 0 : 1,
        data.attempt ?? 1,
        data.error ?? null,
        createdAt,
        data.startedAt ?? null,
        data.completedAt ?? null,
      )

    return requireAutomationRun(id)
  },

  updateRun(id: string, data: UpdateAutomationRunInput): AutomationRun {
    const fields: string[] = []
    const values: unknown[] = []

    if (data.sessionId !== undefined) {
      fields.push('session_id = ?')
      values.push(data.sessionId ?? null)
    }
    if (data.status !== undefined) {
      fields.push('status = ?')
      values.push(data.status)
    }
    if (data.reviewState !== undefined) {
      fields.push('review_state = ?')
      values.push(data.reviewState)
    }
    if (data.unread !== undefined) {
      fields.push('unread = ?')
      values.push(data.unread ? 1 : 0)
    }
    if (data.attempt !== undefined) {
      fields.push('attempt = ?')
      values.push(data.attempt)
    }
    if (data.error !== undefined) {
      fields.push('error = ?')
      values.push(data.error ?? null)
    }
    if (data.startedAt !== undefined) {
      fields.push('started_at = ?')
      values.push(data.startedAt ?? null)
    }
    if (data.completedAt !== undefined) {
      fields.push('completed_at = ?')
      values.push(data.completedAt ?? null)
    }

    if (fields.length > 0) {
      values.push(id)
      getDb()
        .prepare(`UPDATE automation_runs SET ${fields.join(', ')} WHERE id = ?`)
        .run(...values)
    }

    return requireAutomationRun(id)
  },

  markRunAcknowledged(id: string): AutomationRun {
    return automationsStore.updateRun(id, {
      reviewState: 'acknowledged',
      unread: false,
    })
  },

  markRunReviewed(id: string): AutomationRun {
    return automationsStore.updateRun(id, {
      reviewState: 'reviewed',
      unread: false,
    })
  },

  reconcileTriageState(automationId: string): Automation {
    const rows = getDb()
      .prepare(
        `
          SELECT
            COUNT(*) AS unread_count,
            SUM(CASE WHEN review_state = 'unread' THEN 1 ELSE 0 END) AS unread_review_count,
            SUM(CASE WHEN review_state = 'acknowledged' THEN 1 ELSE 0 END) AS acknowledged_count
          FROM automation_runs
          WHERE automation_id = ? AND unread = 1
        `,
      )
      .get(automationId) as
      | { unread_count: number; unread_review_count: number | null; acknowledged_count: number | null }
      | undefined

    const unreadCount = rows?.unread_count ?? 0
    const reviewState: AutomationReviewState =
      unreadCount === 0
        ? 'reviewed'
        : rows?.unread_review_count
          ? 'unread'
          : rows?.acknowledged_count
            ? 'acknowledged'
            : 'reviewed'

    getDb()
      .prepare('UPDATE automations SET unread_run_count = ?, review_state = ? WHERE id = ?')
      .run(unreadCount, reviewState, automationId)

    return requireAutomation(automationId)
  },
}

function requireAutomation(id: string): Automation {
  const automation = automationsStore.get(id)
  if (!automation) {
    throw new Error(`Automation not found: ${id}`)
  }

  return automation
}

function requireAutomationRun(id: string): AutomationRun {
  const run = automationsStore.getRun(id)
  if (!run) {
    throw new Error(`Automation run not found: ${id}`)
  }

  return run
}

function serializeProjectIds(projectIds: string[] | undefined): string | null {
  if (!projectIds || projectIds.length === 0) return null
  return JSON.stringify([...new Set(projectIds)])
}

function parseProjectIds(value: string | null): string[] | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return undefined
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return undefined
  }
}
