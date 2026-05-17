import { randomUUID } from 'node:crypto'
import type { AgentId, Automation } from '../../shared/types'
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
  created_at: number
}

export type CreateAutomationInput = Omit<Automation, 'id' | 'createdAt' | 'lastRunAt'> & {
  id?: string
  createdAt?: number
  lastRunAt?: number | null
}

export type UpdateAutomationInput = Partial<Omit<Automation, 'id' | 'createdAt'>>

function rowToAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    prompt: row.prompt,
    schedule: row.schedule,
    agentId: row.agent_id,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at ?? undefined,
    createdAt: row.created_at,
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

    getDb()
      .prepare(
        `
          INSERT INTO automations (
            id, project_id, name, prompt, schedule, agent_id, enabled, last_run_at, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
}

function requireAutomation(id: string): Automation {
  const automation = automationsStore.get(id)
  if (!automation) {
    throw new Error(`Automation not found: ${id}`)
  }

  return automation
}
