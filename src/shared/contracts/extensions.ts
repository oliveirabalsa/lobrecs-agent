import type { SupportedAgentId } from './agents'

export type ExtensionArtifactKind = 'mcp-server' | 'skill' | 'plugin'
export type ExtensionCatalogKind = ExtensionArtifactKind | 'provider'
export type ExtensionCatalogSource = 'curated' | 'official' | 'community' | 'external'
export type ExtensionInstallScope = 'global' | 'project'
export type ExtensionInstallStatus = 'installed' | 'updated' | 'skipped'
export type ExtensionTargetAgent = Extract<SupportedAgentId, 'claude-code' | 'codex' | 'opencode'>

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
}

export interface ExtensionMarketplaceState {
  catalog: MarketplaceExtension[]
  installed: InstalledExtensionRecord[]
}
