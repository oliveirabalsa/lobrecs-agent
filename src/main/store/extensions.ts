import { randomUUID } from 'node:crypto'
import type {
  ExtensionInstallAction,
  ExtensionInstallScope,
  ExtensionTargetAgent,
  InstalledExtensionRecord,
} from '../../shared/types'
import { getDb } from './db'

type ExtensionInstallationRow = {
  id: string
  extension_id: string
  scope: ExtensionInstallScope
  project_path: string | null
  target_agents: string
  actions: string
  installed_at: number
}

export interface SaveExtensionInstallationInput {
  extensionId: string
  scope: ExtensionInstallScope
  projectPath?: string
  targetAgents: ExtensionTargetAgent[]
  actions: ExtensionInstallAction[]
  installedAt: number
}

export const extensionsStore = {
  list(): InstalledExtensionRecord[] {
    const rows = getDb()
      .prepare(
        `
          SELECT id, extension_id, scope, project_path, target_agents, actions, installed_at
          FROM extension_installations
          ORDER BY installed_at DESC
        `,
      )
      .all() as ExtensionInstallationRow[]

    return rows.map(mapInstallationRow)
  },

  save(input: SaveExtensionInstallationInput): InstalledExtensionRecord {
    const id = randomUUID()
    getDb()
      .prepare(
        `
          INSERT INTO extension_installations (
            id, extension_id, scope, project_path, target_agents, actions, installed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        input.extensionId,
        input.scope,
        input.projectPath ?? null,
        JSON.stringify(input.targetAgents),
        JSON.stringify(input.actions),
        input.installedAt,
      )

    return {
      id,
      extensionId: input.extensionId,
      scope: input.scope,
      projectPath: input.projectPath,
      targetAgents: input.targetAgents,
      actions: input.actions,
      installedAt: input.installedAt,
    }
  },
}

function mapInstallationRow(row: ExtensionInstallationRow): InstalledExtensionRecord {
  return {
    id: row.id,
    extensionId: row.extension_id,
    scope: row.scope,
    projectPath: row.project_path ?? undefined,
    targetAgents: parseStringArray(row.target_agents).filter(isExtensionTargetAgent),
    actions: parseActions(row.actions),
    installedAt: row.installed_at,
  }
}

function parseActions(value: string): ExtensionInstallAction[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isInstallAction)
  } catch {
    return []
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function isInstallAction(value: unknown): value is ExtensionInstallAction {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ExtensionInstallAction>
  return (
    isExtensionTargetAgent(candidate.agentId) &&
    typeof candidate.artifactKind === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.message === 'string'
  )
}

function isExtensionTargetAgent(value: unknown): value is ExtensionTargetAgent {
  return value === 'claude-code' || value === 'codex' || value === 'opencode'
}
