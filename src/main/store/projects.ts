import { randomUUID } from 'node:crypto'
import type { AgentId, ModelTier, Project } from '../../shared/types'
import { getDb } from './db'

type ProjectRow = {
  id: string
  name: string
  repo_path: string
  agent_id: AgentId
  model_tier: ModelTier
  context: string | null
  created_at: number
  updated_at: number
}

export type CreateProjectInput = Omit<Project, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
  context?: string | null
}

export type UpdateProjectInput = Partial<
  Omit<Project, 'id' | 'createdAt' | 'updatedAt'>
> & {
  context?: string | null
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    repoPath: row.repo_path,
    agentId: row.agent_id,
    modelTier: row.model_tier,
    context: row.context,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const projectsStore = {
  list(): Project[] {
    const rows = getDb()
      .prepare('SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC')
      .all() as ProjectRow[]

    return rows.map(rowToProject)
  },

  get(id: string): Project | null {
    const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | ProjectRow
      | undefined

    return row ? rowToProject(row) : null
  },

  getContext(id: string): string | null {
    const row = getDb().prepare('SELECT context FROM projects WHERE id = ?').get(id) as
      | { context: string | null }
      | undefined

    return row?.context ?? null
  },

  create(data: CreateProjectInput): Project {
    const now = Date.now()
    const id = data.id ?? randomUUID()

    getDb()
      .prepare(
        `
          INSERT INTO projects (
            id, name, repo_path, agent_id, model_tier, context, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        data.name,
        data.repoPath,
        data.agentId,
        data.modelTier,
        data.context ?? null,
        now,
        now,
      )

    return requireProject(id)
  },

  update(id: string, data: UpdateProjectInput): Project {
    const fields: string[] = []
    const values: unknown[] = []

    if (data.name !== undefined) {
      fields.push('name = ?')
      values.push(data.name)
    }
    if (data.repoPath !== undefined) {
      fields.push('repo_path = ?')
      values.push(data.repoPath)
    }
    if (data.agentId !== undefined) {
      fields.push('agent_id = ?')
      values.push(data.agentId)
    }
    if (data.modelTier !== undefined) {
      fields.push('model_tier = ?')
      values.push(data.modelTier)
    }
    if (data.context !== undefined) {
      fields.push('context = ?')
      values.push(data.context)
    }

    fields.push('updated_at = ?')
    values.push(Date.now(), id)

    getDb()
      .prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values)

    return requireProject(id)
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
  },
}

function requireProject(id: string): Project {
  const project = projectsStore.get(id)
  if (!project) {
    throw new Error(`Project not found: ${id}`)
  }

  return project
}
