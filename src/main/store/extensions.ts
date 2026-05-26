import { randomUUID } from 'node:crypto'
import type {
  ExecutableExtensionManifest,
  ExtensionDoctorResult,
  ExtensionInstallAction,
  ExtensionInstallScope,
  ExtensionTargetAgent,
  InstalledExecutableExtensionState,
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
  executable_manifest: string | null
  trusted: number
  enabled: number
  doctor_result: string | null
  installed_at: number
  updated_at: number | null
}

export interface SaveExtensionInstallationInput {
  extensionId: string
  scope: ExtensionInstallScope
  projectPath?: string
  targetAgents: ExtensionTargetAgent[]
  actions: ExtensionInstallAction[]
  installedAt: number
  executableManifest?: ExecutableExtensionManifest
}

export interface UpdateExtensionRuntimeStateInput {
  installationId: string
  trusted?: boolean
  enabled?: boolean
}

export interface SaveExtensionDoctorResultInput {
  installationId: string
  result: ExtensionDoctorResult
}

export const extensionsStore = {
  list(): InstalledExtensionRecord[] {
    const rows = getDb()
      .prepare(
        `
          SELECT id, extension_id, scope, project_path, target_agents, actions, installed_at
               , executable_manifest, trusted, enabled, doctor_result, updated_at
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
            id, extension_id, scope, project_path, target_agents, actions,
            executable_manifest, trusted, enabled, doctor_result, installed_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?)
        `,
      )
      .run(
        id,
        input.extensionId,
        input.scope,
        input.projectPath ?? null,
        JSON.stringify(input.targetAgents),
        JSON.stringify(input.actions),
        input.executableManifest ? JSON.stringify(input.executableManifest) : null,
        input.installedAt,
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
      executable: input.executableManifest
        ? {
            manifest: input.executableManifest,
            trusted: false,
            enabled: false,
            scope: input.scope,
          }
        : undefined,
    }
  },

  updateRuntimeState(input: UpdateExtensionRuntimeStateInput): InstalledExtensionRecord {
    const existing = this.get(input.installationId)
    if (!existing) throw new Error(`Extension installation not found: ${input.installationId}`)
    if (!existing.executable) {
      throw new Error('Extension installation does not include executable hooks.')
    }

    const trusted = input.trusted ?? existing.executable.trusted
    if (input.enabled === true && !trusted) {
      throw new Error('Executable extension hooks must be trusted before they can be enabled.')
    }
    const enabled = trusted ? (input.enabled ?? existing.executable.enabled) : false
    getDb()
      .prepare(
        `
          UPDATE extension_installations
          SET trusted = ?, enabled = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(trusted ? 1 : 0, enabled ? 1 : 0, Date.now(), input.installationId)

    const updated = this.get(input.installationId)
    if (!updated) throw new Error(`Extension installation not found: ${input.installationId}`)
    return updated
  },

  saveDoctorResult(input: SaveExtensionDoctorResultInput): InstalledExtensionRecord {
    const existing = this.get(input.installationId)
    if (!existing) throw new Error(`Extension installation not found: ${input.installationId}`)
    if (!existing.executable) {
      throw new Error('Extension installation does not include executable hooks.')
    }

    getDb()
      .prepare(
        `
          UPDATE extension_installations
          SET doctor_result = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(JSON.stringify(input.result), Date.now(), input.installationId)

    const updated = this.get(input.installationId)
    if (!updated) throw new Error(`Extension installation not found: ${input.installationId}`)
    return updated
  },

  get(id: string): InstalledExtensionRecord | null {
    const row = getDb()
      .prepare(
        `
          SELECT id, extension_id, scope, project_path, target_agents, actions, installed_at
               , executable_manifest, trusted, enabled, doctor_result, updated_at
          FROM extension_installations
          WHERE id = ?
        `,
      )
      .get(id) as ExtensionInstallationRow | undefined

    return row ? mapInstallationRow(row) : null
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
    executable: mapExecutableState(row),
  }
}

function mapExecutableState(
  row: ExtensionInstallationRow,
): InstalledExecutableExtensionState | undefined {
  const manifest = parseExecutableManifest(row.executable_manifest)
  if (!manifest) return undefined
  const doctorResult = parseDoctorResult(row.doctor_result)
  return {
    manifest,
    trusted: row.trusted === 1,
    enabled: row.enabled === 1,
    scope: row.scope,
    ...(doctorResult ? { doctorResult } : {}),
  }
}

function parseExecutableManifest(value: string | null): ExecutableExtensionManifest | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return isExecutableManifest(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseDoctorResult(value: string | null): ExtensionDoctorResult | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Partial<ExtensionDoctorResult>
    if (
      !isDoctorStatus(candidate.status) ||
      typeof candidate.message !== 'string' ||
      typeof candidate.checkedAt !== 'number'
    ) {
      return null
    }
    return {
      status: candidate.status,
      message: candidate.message,
      checkedAt: candidate.checkedAt,
      ...(typeof candidate.stderr === 'string' ? { stderr: candidate.stderr } : {}),
    }
  } catch {
    return null
  }
}

function isExecutableManifest(value: unknown): value is ExecutableExtensionManifest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ExecutableExtensionManifest>
  return (
    typeof candidate.command === 'string' &&
    isExtensionRuntime(candidate.runtime) &&
    Array.isArray(candidate.hooks) &&
    candidate.hooks.every(isExtensionHookKind) &&
    Array.isArray(candidate.capabilities) &&
    candidate.capabilities.every((capability) => typeof capability === 'string') &&
    isExtensionHookScope(candidate.scope) &&
    (candidate.args === undefined ||
      (Array.isArray(candidate.args) && candidate.args.every((arg) => typeof arg === 'string'))) &&
    (candidate.timeoutMs === undefined || typeof candidate.timeoutMs === 'number')
  )
}

function isExtensionRuntime(value: unknown): value is ExecutableExtensionManifest['runtime'] {
  return value === 'node' || value === 'binary' || value === 'shell'
}

function isExtensionHookKind(value: unknown): value is ExecutableExtensionManifest['hooks'][number] {
  return (
    value === 'prompt-decoration' ||
    value === 'review-provider-registration' ||
    value === 'quality-gate-observation' ||
    value === 'retry-gating'
  )
}

function isExtensionHookScope(value: unknown): value is ExecutableExtensionManifest['scope'] {
  return value === 'global' || value === 'project' || value === 'both'
}

function isDoctorStatus(value: unknown): value is ExtensionDoctorResult['status'] {
  return value === 'passed' || value === 'warning' || value === 'failed' || value === 'not-run'
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
