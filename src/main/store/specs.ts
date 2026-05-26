import { randomUUID } from 'node:crypto'
import { assertSpecStatusTransition } from '../modules/specs/domain/specStatus'
import { SUPPORTED_AGENT_IDS } from '../../shared/types'
import type {
  AcceptanceCriterion,
  CreateSpecInput,
  RunMode,
  Spec,
  SpecRequirement,
  SpecStatus,
  SupportedAgentId,
  UpdateSpecInput,
} from '../../shared/types'
import { getDb } from './db'

type SpecRow = {
  id: string
  project_id: string
  title: string
  goal: string
  context: string
  constraints: string
  done_when: string
  target_files: string
  selected_agents: string
  agent_profile_ids: string
  run_mode: RunMode
  status: SpecStatus
  approved_at: number | null
  created_at: number
  updated_at: number
}

type RequirementRow = {
  id: string
  spec_id: string
  body: string
  position: number
  satisfied: 0 | 1
}

type CriterionRow = {
  id: string
  spec_id: string
  body: string
  position: number
  verified: 0 | 1
}

function rowToRequirement(row: RequirementRow): SpecRequirement {
  return {
    id: row.id,
    specId: row.spec_id,
    body: row.body,
    position: row.position,
    satisfied: row.satisfied === 1,
  }
}

function rowToCriterion(row: CriterionRow): AcceptanceCriterion {
  return {
    id: row.id,
    specId: row.spec_id,
    body: row.body,
    position: row.position,
    verified: row.verified === 1,
  }
}

function rowToSpec(
  row: SpecRow,
  requirements: SpecRequirement[],
  acceptanceCriteria: AcceptanceCriterion[],
): Spec {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    goal: row.goal,
    context: row.context,
    constraints: row.constraints,
    doneWhen: row.done_when,
    targetFiles: readStringArray(row.target_files),
    selectedAgents: readSupportedAgents(row.selected_agents),
    selectedAgentProfiles: readStringArray(row.agent_profile_ids ?? '[]'),
    runMode: localRunMode(),
    status: row.status,
    approvedAt: row.approved_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requirements,
    acceptanceCriteria,
  }
}

export const specsStore = {
  list(projectId: string): Spec[] {
    const rows = getDb()
      .prepare('SELECT * FROM specs WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC')
      .all(projectId) as SpecRow[]

    return rows.map((row) => hydrateSpec(row))
  },

  get(id: string): Spec | null {
    const row = getDb().prepare('SELECT * FROM specs WHERE id = ?').get(id) as
      | SpecRow
      | undefined

    return row ? hydrateSpec(row) : null
  },

  create(data: CreateSpecInput): Spec {
    const id = randomUUID()
    const now = Date.now()
    const db = getDb()

    const createSpec = db.transaction(() => {
      db.prepare(
        `
          INSERT INTO specs (
            id, project_id, title, goal, context, constraints, done_when,
            target_files, selected_agents, agent_profile_ids, run_mode, status, approved_at, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)
        `,
      ).run(
        id,
        data.projectId,
        data.title.trim(),
        data.goal.trim(),
        data.context?.trim() ?? '',
        data.constraints?.trim() ?? '',
        data.doneWhen?.trim() ?? '',
        JSON.stringify(data.targetFiles ?? []),
        JSON.stringify(data.selectedAgents ?? ['codex']),
        JSON.stringify(data.selectedAgentProfiles ?? []),
        localRunMode(),
        now,
        now,
      )

      replaceRequirements(id, data.requirements ?? [])
      replaceCriteria(id, data.acceptanceCriteria ?? [])
    })

    createSpec()
    return requireSpec(id)
  },

  update(id: string, data: UpdateSpecInput): Spec {
    const db = getDb()
    const updateSpec = db.transaction(() => {
      const fields: string[] = []
      const values: unknown[] = []

      if (data.title !== undefined) {
        fields.push('title = ?')
        values.push(data.title.trim())
      }
      if (data.goal !== undefined) {
        fields.push('goal = ?')
        values.push(data.goal.trim())
      }
      if (data.context !== undefined) {
        fields.push('context = ?')
        values.push(data.context.trim())
      }
      if (data.constraints !== undefined) {
        fields.push('constraints = ?')
        values.push(data.constraints.trim())
      }
      if (data.doneWhen !== undefined) {
        fields.push('done_when = ?')
        values.push(data.doneWhen.trim())
      }
      if (data.targetFiles !== undefined) {
        fields.push('target_files = ?')
        values.push(JSON.stringify(data.targetFiles))
      }
      if (data.selectedAgents !== undefined) {
        fields.push('selected_agents = ?')
        values.push(JSON.stringify(data.selectedAgents))
      }
      if (data.selectedAgentProfiles !== undefined) {
        fields.push('agent_profile_ids = ?')
        values.push(JSON.stringify(data.selectedAgentProfiles))
      }
      if (data.runMode !== undefined) {
        fields.push('run_mode = ?')
        values.push(localRunMode())
      }

      fields.push('updated_at = ?')
      values.push(Date.now(), id)

      db.prepare(`UPDATE specs SET ${fields.join(', ')} WHERE id = ?`).run(...values)

      if (data.requirements !== undefined) {
        replaceRequirements(id, data.requirements)
      }
      if (data.acceptanceCriteria !== undefined) {
        replaceCriteria(id, data.acceptanceCriteria)
      }
    })

    updateSpec()
    return requireSpec(id)
  },

  approve(id: string): Spec {
    const spec = requireSpec(id)
    assertSpecStatusTransition(spec.status, 'approved')

    const now = Date.now()
    getDb()
      .prepare('UPDATE specs SET status = ?, approved_at = ?, updated_at = ? WHERE id = ?')
      .run('approved', now, now, id)

    return requireSpec(id)
  },

  setStatus(id: string, status: SpecStatus): Spec {
    const spec = requireSpec(id)
    assertSpecStatusTransition(spec.status, status)

    const now = Date.now()
    const completedApproval = status === 'approved' ? now : spec.approvedAt
    getDb()
      .prepare('UPDATE specs SET status = ?, approved_at = ?, updated_at = ? WHERE id = ?')
      .run(status, completedApproval ?? null, now, id)

    return requireSpec(id)
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM specs WHERE id = ?').run(id)
  },
}

function hydrateSpec(row: SpecRow): Spec {
  const requirements = getDb()
    .prepare('SELECT * FROM spec_requirements WHERE spec_id = ? ORDER BY position ASC')
    .all(row.id) as RequirementRow[]
  const criteria = getDb()
    .prepare('SELECT * FROM spec_acceptance_criteria WHERE spec_id = ? ORDER BY position ASC')
    .all(row.id) as CriterionRow[]

  return rowToSpec(row, requirements.map(rowToRequirement), criteria.map(rowToCriterion))
}

function localRunMode(): RunMode {
  return 'local'
}

function replaceRequirements(specId: string, requirements: string[]): void {
  const db = getDb()
  db.prepare('DELETE FROM spec_requirements WHERE spec_id = ?').run(specId)

  const insert = db.prepare(
    `
      INSERT INTO spec_requirements (id, spec_id, body, position, satisfied)
      VALUES (?, ?, ?, ?, 0)
    `,
  )

  normalizedLines(requirements).forEach((body, index) => {
    insert.run(randomUUID(), specId, body, index)
  })
}

function replaceCriteria(specId: string, acceptanceCriteria: string[]): void {
  const db = getDb()
  db.prepare('DELETE FROM spec_acceptance_criteria WHERE spec_id = ?').run(specId)

  const insert = db.prepare(
    `
      INSERT INTO spec_acceptance_criteria (id, spec_id, body, position, verified)
      VALUES (?, ?, ?, ?, 0)
    `,
  )

  normalizedLines(acceptanceCriteria).forEach((body, index) => {
    insert.run(randomUUID(), specId, body, index)
  })
}

function normalizedLines(lines: string[]): string[] {
  return lines.map((line) => line.trim()).filter(Boolean)
}

function requireSpec(id: string): Spec {
  const spec = specsStore.get(id)
  if (!spec) {
    throw new Error(`Spec not found: ${id}`)
  }

  return spec
}

function readStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
  } catch {
    // Keep corrupt persisted JSON from crashing the renderer.
  }

  return []
}

function readSupportedAgents(value: string): SupportedAgentId[] {
  return readStringArray(value).filter(isSupportedAgentId)
}

function isSupportedAgentId(agentId: string): agentId is SupportedAgentId {
  return SUPPORTED_AGENT_IDS.includes(agentId as SupportedAgentId)
}
