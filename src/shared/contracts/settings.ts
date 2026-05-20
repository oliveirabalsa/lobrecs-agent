import type { ModelTier, SupportedAgentId } from './agents'
import type { SwarmStrategy } from './swarms'
import type { VerificationRecipe } from './system'

export const SETTINGS_SCHEMA_VERSION = 1

export type SettingsSchemaVersion = typeof SETTINGS_SCHEMA_VERSION

export type SettingsSectionKey =
  | 'general'
  | 'agents'
  | 'routing'
  | 'execution'
  | 'swarms'
  | 'specs'
  | 'verification'
  | 'costs'
  | 'ui'
  | 'editor'

export const SETTINGS_SECTION_KEYS: readonly SettingsSectionKey[] = [
  'general',
  'agents',
  'routing',
  'execution',
  'swarms',
  'specs',
  'verification',
  'costs',
  'ui',
  'editor',
]

export type AgentPermissionMode =
  | 'dangerous'
  | 'bypass-permissions'
  | 'ask-for-approval'
  | 'read-only'

export interface GeneralSettings {
  appName: string
  startOnLaunch: boolean
  openLastProjectOnLaunch: boolean
  enableDesktopNotifications: boolean
  checkForUpdates: boolean
}

export interface AgentRuntimeSettings {
  enabled: boolean
  command: string
  permissionMode: AgentPermissionMode
  extraArgs: string[]
}

export interface AgentSettings {
  defaultAgentId: SupportedAgentId
  fallbackAgentId: SupportedAgentId
  enabledAgentIds: SupportedAgentId[]
  runtimes: Record<SupportedAgentId, AgentRuntimeSettings>
  modelMap: Record<SupportedAgentId, Record<ModelTier, string>>
  imageAttachments: {
    maxCount: number
    maxSizeMb: number
  }
}

export interface RoutingSettings {
  tierThresholds: {
    lightweightMax: number
    balancedMax: number
    advancedMax: number
  }
  securityMinimumTier: ModelTier
  allowOpenCodeForFrontier: boolean
  useRecentFailureEscalation: boolean
}

export interface ExecutionSettings {
  worktreeIsolation: boolean
  autoApplyCompletedDiffs: boolean
  defaultApprovalMode: AgentPermissionMode
  maxQueuedMessagesPerThread: number
  commandPrefix: string
  warnWhenCommandMissingPrefix: boolean
  sessionOutputRetentionDays: number
}

export interface SwarmTemplate {
  id: string
  label: string
  strategy: SwarmStrategy
  agents: Array<{
    role: string
    agentId: SupportedAgentId
    modelOverride?: string
    promptSuffix?: string
  }>
}

export interface SwarmSettings {
  defaultStrategy: SwarmTemplate['strategy']
  maxAgents: number
  maxReviewerIterations: number
  defaultAgents: SwarmTemplate['agents']
  rolePrompts: Record<string, string>
  templates: SwarmTemplate[]
}

export interface SpecSettings {
  defaultAgentIds: SupportedAgentId[]
  defaultRunMode: 'local'
  defaultVerificationRecipeIds: string[]
  targetFileLimit: number
  requireApprovalBeforeRun: boolean
}

export interface VerificationSettings {
  recipes: VerificationRecipe[]
  requireCommandPrefix: boolean
  maxOutputBytes: number
  defaultTimeoutSeconds: number
  autoRunAfterAgentDiffs: boolean
  selfHealingMaxAttempts: number
}

export interface ModelPricing {
  inputPer1M: number
  outputPer1M: number
}

export interface CostSettings {
  currency: 'USD'
  monthlyBudgetUsd: number
  warnAtPercent: number
  pricing: Record<string, ModelPricing>
}

export interface UiSettings {
  compactMode: boolean
  sidebarDefaultWidth: number
  rightPanelDefaultOpen: boolean
  rightPanelDefaultMode: 'diff' | 'terminal'
  terminalDefaultHeight: number
  showCostBadges: boolean
  showTokenCounts: boolean
}

export interface EditorSettings {
  defaultEditorId: string
  cliEditorId: string
  fontSize: number
  tabSize: number
  wordWrap: boolean
  formatOnSave: boolean
}

export interface AppSettings {
  schemaVersion: SettingsSchemaVersion
  general: GeneralSettings
  agents: AgentSettings
  routing: RoutingSettings
  execution: ExecutionSettings
  swarms: SwarmSettings
  specs: SpecSettings
  verification: VerificationSettings
  costs: CostSettings
  ui: UiSettings
  editor: EditorSettings
}

export type SettingsPatch<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: SettingsPatch<T[K]> }
    : T

export type AppSettingsPatch = SettingsPatch<AppSettings>

export interface ProjectSettingsOverrides {
  schemaVersion: SettingsSchemaVersion
  projectId: string
  overrides: AppSettingsPatch
  updatedAt: number
}

export interface EffectiveAppSettings {
  projectId?: string
  global: AppSettings
  projectOverrides: ProjectSettingsOverrides | null
  settings: AppSettings
}

export interface SettingsUpdateEvent {
  scope: 'global' | 'project'
  projectId?: string
  settings: AppSettings
  effective: AppSettings
  updatedAt: number
}
