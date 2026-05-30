import type { SupportedAgentId } from './agents'
import {
  assertAbsolutePath,
  assertOneOf,
  assertRecord,
  assertString,
  optionalInteger,
} from './validation'

export type ExtensionArtifactKind = 'mcp-server' | 'skill' | 'plugin'
export type ExtensionCatalogKind = ExtensionArtifactKind | 'provider'
export type ExtensionCatalogSource = 'curated' | 'official' | 'community' | 'external'
export type ExtensionInstallScope = 'global' | 'project'
export type ExtensionInstallStatus = 'installed' | 'updated' | 'skipped'
export type ExtensionTargetAgent = Extract<SupportedAgentId, 'claude-code' | 'codex' | 'opencode'>
export type ExtensionRuntime = 'node' | 'binary' | 'shell'
export type ExtensionHookKind =
  | 'prompt-decoration'
  | 'review-provider-registration'
  | 'quality-gate-observation'
  | 'retry-gating'
export type ExtensionHookScope = ExtensionInstallScope | 'both'
export type ExtensionDoctorStatus = 'passed' | 'warning' | 'failed' | 'not-run'

export interface ExecutableExtensionManifest {
  command: string
  args?: string[]
  runtime: ExtensionRuntime
  hooks: ExtensionHookKind[]
  capabilities: string[]
  scope: ExtensionHookScope
  timeoutMs?: number
}

export interface ExtensionDoctorResult {
  status: ExtensionDoctorStatus
  message: string
  checkedAt: number
  stderr?: string
}

export interface InstalledExecutableExtensionState {
  manifest: ExecutableExtensionManifest
  trusted: boolean
  enabled: boolean
  scope: ExtensionInstallScope
  doctorResult?: ExtensionDoctorResult
}

export interface ExtensionMcpServerArtifact {
  kind: 'mcp-server'
  serverName: string
  transport: 'http' | 'stdio'
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
}

export interface ExtensionInlineSkillArtifact {
  kind: 'skill'
  skillName: string
  description: string
  body: string
}

export interface ExtensionSkillsCliArtifact {
  kind: 'skill'
  skillName: string
  description: string
  packageName: string
  cliSkillName?: string
  installUrl?: string
}

export type ExtensionSkillArtifact = ExtensionInlineSkillArtifact | ExtensionSkillsCliArtifact

export interface ExtensionPluginArtifact {
  kind: 'plugin'
  agentId: ExtensionTargetAgent
  packageName: string
}

export type ExtensionArtifact =
  | ExtensionMcpServerArtifact
  | ExtensionSkillArtifact
  | ExtensionPluginArtifact

export interface MarketplaceExtension {
  id: string
  name: string
  summary: string
  description: string
  publisher: string
  category: ExtensionCatalogKind
  source: ExtensionCatalogSource
  tags: string[]
  artifacts: ExtensionArtifact[]
  targetAgents: ExtensionTargetAgent[]
  featured?: boolean
  recommended?: boolean
  requiresProject?: boolean
  homepageUrl?: string
  documentationUrl?: string
  setupNotes?: string[]
  permissions?: string[]
  executable?: ExecutableExtensionManifest
}

export interface SearchMarketplaceExtensionsInput {
  query?: string
  categories?: ExtensionCatalogKind[]
  sources?: ExtensionCatalogSource[]
  targetAgents?: ExtensionTargetAgent[]
  tags?: string[]
  limit?: number
}

export interface MarketplaceCatalogSearchResult {
  items: MarketplaceExtension[]
  total: number
  tags: string[]
  publishers: string[]
}

export interface InstallExtensionInput {
  extensionId: string
  scope: ExtensionInstallScope
  projectPath?: string
  targetAgents?: ExtensionTargetAgent[]
}

export interface ExtensionInstallAction {
  agentId: ExtensionTargetAgent
  artifactKind: ExtensionArtifactKind
  status: ExtensionInstallStatus
  message: string
  filePath?: string
  followUpCommand?: string
}

export interface ExtensionInstallResult {
  extensionId: string
  scope: ExtensionInstallScope
  projectPath?: string
  actions: ExtensionInstallAction[]
  installedAt: number
}

export interface InstalledExtensionRecord {
  id: string
  extensionId: string
  scope: ExtensionInstallScope
  projectPath?: string
  targetAgents: ExtensionTargetAgent[]
  actions: ExtensionInstallAction[]
  installedAt: number
  executable?: InstalledExecutableExtensionState
}

export interface UpdateExtensionRuntimeStateInput {
  installationId: string
  trusted?: boolean
  enabled?: boolean
}

export interface RunExtensionDoctorInput {
  installationId: string
}

export interface ExtensionMarketplaceState {
  catalog: MarketplaceExtension[]
  installed: InstalledExtensionRecord[]
}

const EXTENSION_CATALOG_KINDS = ['mcp-server', 'skill', 'plugin', 'provider'] as const
const EXTENSION_CATALOG_SOURCES = ['curated', 'official', 'community', 'external'] as const
const EXTENSION_INSTALL_SCOPES = ['global', 'project'] as const
const EXTENSION_TARGET_AGENTS = ['claude-code', 'codex', 'opencode'] as const

export function validateSearchMarketplaceExtensionsInput(
  input: unknown = {},
): SearchMarketplaceExtensionsInput {
  const value =
    input === undefined || input === null ? {} : assertRecord(input, 'Extension search input')

  const query = optionalTrimmedString(value.query, 'Extension search query', 200)
  const categories = optionalStringArray(value.categories, 'Extension categories', (item) =>
    assertOneOf(item, 'Extension category', EXTENSION_CATALOG_KINDS),
  )
  const sources = optionalStringArray(value.sources, 'Extension sources', (item) =>
    assertOneOf(item, 'Extension source', EXTENSION_CATALOG_SOURCES),
  )
  const targetAgents = optionalStringArray(value.targetAgents, 'Extension target agents', (item) =>
    assertOneOf(item, 'Extension target agent', EXTENSION_TARGET_AGENTS),
  )
  const tags = optionalStringArray(value.tags, 'Extension tags', (item) =>
    assertString(item, 'Extension tag', { maxLength: 80 }).trim(),
  )
  const limit = optionalInteger(value.limit, 'Extension search limit', { min: 1, max: 100 })

  return {
    ...(query === undefined ? {} : { query }),
    ...(categories === undefined ? {} : { categories }),
    ...(sources === undefined ? {} : { sources }),
    ...(targetAgents === undefined ? {} : { targetAgents }),
    ...(tags === undefined ? {} : { tags }),
    ...(limit === undefined ? {} : { limit }),
  }
}

export function validateInstallExtensionInput(input: unknown): InstallExtensionInput {
  const value = assertRecord(input, 'Extension install input')
  const scope = assertOneOf(value.scope, 'Extension install scope', EXTENSION_INSTALL_SCOPES)
  const projectPath =
    value.projectPath === undefined || value.projectPath === null || value.projectPath === ''
      ? undefined
      : assertAbsolutePath(value.projectPath, 'Extension project path')

  if (scope === 'project' && !projectPath) {
    throw new Error('Project-scoped extension installs require a project path.')
  }
  const targetAgents = validateTargetAgents(value.targetAgents)

  return {
    extensionId: assertExtensionId(value.extensionId),
    scope,
    ...(projectPath === undefined ? {} : { projectPath }),
    ...(targetAgents === undefined ? {} : { targetAgents }),
  }
}

function validateTargetAgents(value: unknown): ExtensionTargetAgent[] | undefined {
  return optionalStringArray(value, 'Extension target agents', (item) =>
    assertOneOf(item, 'Extension target agent', EXTENSION_TARGET_AGENTS),
  )
}

export function validateUpdateExtensionRuntimeStateInput(
  input: unknown,
): UpdateExtensionRuntimeStateInput {
  const value = assertRecord(input, 'Extension runtime state input')
  const trusted = optionalBooleanValue(value.trusted, 'trusted')
  const enabled = optionalBooleanValue(value.enabled, 'enabled')

  return {
    installationId: assertExtensionId(value.installationId),
    ...(trusted === undefined ? {} : { trusted }),
    ...(enabled === undefined ? {} : { enabled }),
  }
}

export function validateRunExtensionDoctorInput(input: unknown): RunExtensionDoctorInput {
  const value = assertRecord(input, 'Extension doctor input')
  return {
    installationId: assertExtensionId(value.installationId),
  }
}

function assertExtensionId(value: unknown): string {
  const id = assertString(value, 'Extension id', { maxLength: 300 }).trim()
  if (!/^[a-zA-Z0-9._:/@-]+$/.test(id)) {
    throw new Error('Extension id contains unsupported characters.')
  }
  if (id.includes('..')) {
    throw new Error('Extension id cannot contain path traversal segments.')
  }
  return id
}

function optionalTrimmedString(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null) return undefined
  const trimmed = assertString(value, label, { maxLength, allowEmpty: true }).trim()
  return trimmed ? trimmed : undefined
}

function optionalStringArray<T extends string>(
  value: unknown,
  label: string,
  mapper: (item: unknown) => T,
): T[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`)
  }
  if (value.length > 50) {
    throw new Error(`${label} contains too many values.`)
  }
  return [...new Set(value.map(mapper))]
}

function optionalBooleanValue(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be boolean`)
  }
  return value
}
