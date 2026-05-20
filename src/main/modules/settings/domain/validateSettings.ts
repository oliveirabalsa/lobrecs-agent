import {
  SETTINGS_SCHEMA_VERSION,
  SUPPORTED_AGENT_IDS,
  type AgentPermissionMode,
  type AppSettings,
  type AppSettingsPatch,
  type ModelTier,
  type ProjectSettingsOverrides,
  type SupportedAgentId,
  type SwarmTemplate,
  type VerificationRecipe,
  type VerificationRecipeScope,
} from '../../../../shared/types'
import { cloneSettings, mergeSettings } from './mergeSettings'
import { DEFAULT_APP_SETTINGS } from './defaultSettings'

const LEGACY_GEMINI_AGENT_ID = 'gemini'
const ANTIGRAVITY_AGENT_ID = 'antigravity'
const LEGACY_DEFAULT_AGENT_IDS = SUPPORTED_AGENT_IDS.filter(
  (agentId) => agentId !== ANTIGRAVITY_AGENT_ID,
)
const MODEL_TIERS: readonly ModelTier[] = [
  'lightweight',
  'balanced',
  'advanced',
  'frontier',
]
const PERMISSION_MODES: readonly AgentPermissionMode[] = [
  'dangerous',
  'bypass-permissions',
  'ask-for-approval',
  'read-only',
]

export function normalizeSettings(input: unknown): AppSettings {
  const merged = mergeSettings(
    DEFAULT_APP_SETTINGS,
    objectLike(migrateLegacyGeminiAgent(input)) as AppSettingsPatch,
  )
  return sanitizeSettingsShape(merged)
}

export function normalizeSettingsPatch(input: unknown): AppSettingsPatch {
  const candidate = objectLike(migrateLegacyGeminiAgent(input))
  const normalized = normalizeSettings(mergeSettings(DEFAULT_APP_SETTINGS, candidate as AppSettingsPatch))
  return pickPatchShape(candidate, normalized) as AppSettingsPatch
}

export function normalizeProjectOverrides(
  projectId: string,
  input: unknown,
  updatedAt = Date.now(),
): ProjectSettingsOverrides {
  const record = objectLike(input)
  const overrides = 'overrides' in record ? record.overrides : record

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    projectId,
    overrides: normalizeSettingsPatch(overrides),
    updatedAt,
  }
}

export function sanitizeSettingsShape(settings: AppSettings): AppSettings {
  const cloned = cloneSettings(settings)
  const enabledAgentIds = normalizeEnabledAgents(cloned.agents.enabledAgentIds)
  const defaultAgentId = supportedAgentOr(
    cloned.agents.defaultAgentId,
    enabledAgentIds[0] ?? DEFAULT_APP_SETTINGS.agents.defaultAgentId,
  )
  const fallbackAgentId = supportedAgentOr(cloned.agents.fallbackAgentId, defaultAgentId)

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    general: {
      appName: stringOr(cloned.general.appName, DEFAULT_APP_SETTINGS.general.appName),
      startOnLaunch: booleanOr(cloned.general.startOnLaunch, false),
      openLastProjectOnLaunch: booleanOr(cloned.general.openLastProjectOnLaunch, true),
      enableDesktopNotifications: booleanOr(
        cloned.general.enableDesktopNotifications,
        true,
      ),
      checkForUpdates: booleanOr(cloned.general.checkForUpdates, true),
    },
    agents: {
      defaultAgentId,
      fallbackAgentId,
      enabledAgentIds: enabledAgentIds.length > 0 ? enabledAgentIds : [defaultAgentId],
      runtimes: normalizeAgentRuntimes(cloned.agents.runtimes),
      modelMap: normalizeAgentModelMap(cloned.agents.modelMap),
      imageAttachments: {
        maxCount: clampInteger(cloned.agents.imageAttachments.maxCount, 0, 20, 8),
        maxSizeMb: clampNumber(cloned.agents.imageAttachments.maxSizeMb, 1, 100, 20),
      },
    },
    routing: {
      tierThresholds: normalizeTierThresholds(cloned.routing.tierThresholds),
      securityMinimumTier: modelTierOr(
        cloned.routing.securityMinimumTier,
        DEFAULT_APP_SETTINGS.routing.securityMinimumTier,
      ),
      allowOpenCodeForFrontier: booleanOr(cloned.routing.allowOpenCodeForFrontier, false),
      useRecentFailureEscalation: booleanOr(
        cloned.routing.useRecentFailureEscalation,
        true,
      ),
    },
    execution: {
      worktreeIsolation: booleanOr(cloned.execution.worktreeIsolation, false),
      autoApplyCompletedDiffs: booleanOr(cloned.execution.autoApplyCompletedDiffs, true),
      defaultApprovalMode: permissionModeOr(
        cloned.execution.defaultApprovalMode,
        'dangerous',
      ),
      maxQueuedMessagesPerThread: clampInteger(
        cloned.execution.maxQueuedMessagesPerThread,
        1,
        100,
        20,
      ),
      commandPrefix: stringOr(cloned.execution.commandPrefix, 'rtk').trim() || 'rtk',
      warnWhenCommandMissingPrefix: booleanOr(
        cloned.execution.warnWhenCommandMissingPrefix,
        true,
      ),
      sessionOutputRetentionDays: clampInteger(
        cloned.execution.sessionOutputRetentionDays,
        1,
        365,
        30,
      ),
    },
    swarms: {
      defaultStrategy: swarmStrategyOr(cloned.swarms.defaultStrategy, 'parallel'),
      maxAgents: clampInteger(cloned.swarms.maxAgents, 1, 16, 8),
      maxReviewerIterations: clampInteger(cloned.swarms.maxReviewerIterations, 1, 10, 3),
      defaultAgents: normalizeTemplateAgents(cloned.swarms.defaultAgents).slice(
        0,
        clampInteger(cloned.swarms.maxAgents, 1, 16, 8),
      ),
      rolePrompts: normalizeStringRecord(cloned.swarms.rolePrompts),
      templates: normalizeTemplates(cloned.swarms.templates),
    },
    specs: {
      defaultAgentIds: uniqueSupportedAgents(cloned.specs.defaultAgentIds),
      defaultRunMode: 'local',
      defaultVerificationRecipeIds: stringArray(cloned.specs.defaultVerificationRecipeIds),
      targetFileLimit: clampInteger(cloned.specs.targetFileLimit, 1, 100, 12),
      requireApprovalBeforeRun: booleanOr(cloned.specs.requireApprovalBeforeRun, true),
    },
    verification: {
      recipes: normalizeVerificationRecipes(cloned.verification.recipes),
      requireCommandPrefix: booleanOr(cloned.verification.requireCommandPrefix, true),
      maxOutputBytes: clampInteger(cloned.verification.maxOutputBytes, 16_384, 5_000_000, 512_000),
      defaultTimeoutSeconds: clampInteger(
        cloned.verification.defaultTimeoutSeconds,
        5,
        1_800,
        120,
      ),
    },
    costs: {
      currency: 'USD',
      monthlyBudgetUsd: clampNumber(cloned.costs.monthlyBudgetUsd, 0, 100_000, 50),
      warnAtPercent: clampInteger(cloned.costs.warnAtPercent, 1, 100, 80),
      pricing: normalizePricing(cloned.costs.pricing),
    },
    ui: {
      compactMode: booleanOr(cloned.ui.compactMode, false),
      sidebarDefaultWidth: clampInteger(cloned.ui.sidebarDefaultWidth, 220, 420, 260),
      rightPanelDefaultOpen: booleanOr(cloned.ui.rightPanelDefaultOpen, false),
      rightPanelDefaultMode: cloned.ui.rightPanelDefaultMode === 'terminal' ? 'terminal' : 'diff',
      terminalDefaultHeight: clampInteger(cloned.ui.terminalDefaultHeight, 160, 640, 260),
      showCostBadges: booleanOr(cloned.ui.showCostBadges, true),
      showTokenCounts: booleanOr(cloned.ui.showTokenCounts, true),
    },
    editor: {
      defaultEditorId: stringOr(cloned.editor.defaultEditorId, ''),
      cliEditorId: stringOr(cloned.editor.cliEditorId, 'shell') || 'shell',
      fontSize: clampInteger(cloned.editor.fontSize, 10, 24, 13),
      tabSize: clampInteger(cloned.editor.tabSize, 1, 8, 2),
      wordWrap: booleanOr(cloned.editor.wordWrap, true),
      formatOnSave: booleanOr(cloned.editor.formatOnSave, false),
    },
  }
}

function normalizeRuntime(runtime: unknown): AppSettings['agents']['runtimes'][SupportedAgentId] {
  const record = objectLike(runtime)

  return {
    enabled: booleanOr(record.enabled, true),
    command: stringOr(record.command, '').trim(),
    permissionMode: permissionModeOr(record.permissionMode, 'dangerous'),
    extraArgs: stringArray(record.extraArgs),
  }
}

function normalizeAgentRuntimes(runtimes: unknown): AppSettings['agents']['runtimes'] {
  const source = objectLike(migrateLegacyGeminiAgent(runtimes))

  return Object.fromEntries(
    SUPPORTED_AGENT_IDS.map((agentId) => [agentId, normalizeRuntime(source[agentId])]),
  ) as AppSettings['agents']['runtimes']
}

function normalizeAgentModelMap(modelMap: unknown): AppSettings['agents']['modelMap'] {
  const source = objectLike(migrateLegacyGeminiAgent(modelMap))

  return Object.fromEntries(
    SUPPORTED_AGENT_IDS.map((agentId) => [
      agentId,
      normalizeModelMap(agentId, source[agentId]),
    ]),
  ) as AppSettings['agents']['modelMap']
}

function normalizeModelMap(
  agentId: SupportedAgentId,
  map: unknown,
): Record<ModelTier, string> {
  const record = objectLike(map)
  const fallback = DEFAULT_APP_SETTINGS.agents.modelMap[agentId]

  return {
    lightweight: stringOr(record.lightweight, fallback.lightweight),
    balanced: stringOr(record.balanced, fallback.balanced),
    advanced: stringOr(record.advanced, fallback.advanced),
    frontier: stringOr(record.frontier, fallback.frontier),
  }
}

function normalizeTierThresholds(
  thresholds: AppSettings['routing']['tierThresholds'],
): AppSettings['routing']['tierThresholds'] {
  const lightweightMax = clampInteger(thresholds.lightweightMax, 1, 99, 30)
  const balancedMax = clampInteger(thresholds.balancedMax, lightweightMax + 1, 99, 65)
  const advancedMax = clampInteger(thresholds.advancedMax, balancedMax + 1, 99, 85)

  return { lightweightMax, balancedMax, advancedMax }
}

function normalizeTemplates(templates: unknown): SwarmTemplate[] {
  const values = Array.isArray(templates) ? templates : DEFAULT_APP_SETTINGS.swarms.templates

  return values
    .map((template, index): SwarmTemplate | null => {
      const record = objectLike(template)
      const id = stringOr(record.id, `template-${index + 1}`).trim()
      const label = stringOr(record.label, id).trim()
      const agents = normalizeTemplateAgents(record.agents)

      if (!id || !label || agents.length === 0) return null

      return {
        id,
        label,
        strategy: swarmStrategyOr(record.strategy, 'parallel'),
        agents,
      }
    })
    .filter((template): template is SwarmTemplate => template !== null)
    .slice(0, 20)
}

function normalizeTemplateAgents(agents: unknown): SwarmTemplate['agents'] {
  const values = Array.isArray(agents) ? agents : []

  return values
    .map((agent): SwarmTemplate['agents'][number] | null => {
      const record = objectLike(agent)
      const role = stringOr(record.role, '').trim()
      const agentId = supportedAgentOr(record.agentId, 'claude-code')
      if (!role) return null

      return {
        role,
        agentId,
        modelOverride: optionalString(record.modelOverride),
        promptSuffix: optionalString(record.promptSuffix),
      }
    })
    .filter((agent): agent is SwarmTemplate['agents'][number] => agent !== null)
}

function normalizeVerificationRecipes(recipes: unknown): VerificationRecipe[] {
  const values = Array.isArray(recipes) ? recipes : DEFAULT_APP_SETTINGS.verification.recipes

  return values
    .map((recipe, index): VerificationRecipe | null => {
      const record = objectLike(recipe)
      const id = stringOr(record.id, `recipe-${index + 1}`).trim()
      const label = stringOr(record.label, id).trim()
      const command = stringOr(record.command, '').trim()
      const scope = verificationRecipeScopeOr(record.scope, 'custom')

      if (!id || !label || !command) return null

      return {
        id,
        label,
        command,
        scope,
        description: optionalString(record.description),
      }
    })
    .filter((recipe): recipe is VerificationRecipe => recipe !== null)
    .slice(0, 30)
}

function normalizePricing(pricing: unknown): AppSettings['costs']['pricing'] {
  const record = objectLike(pricing)
  const next: AppSettings['costs']['pricing'] = { ...DEFAULT_APP_SETTINGS.costs.pricing }

  for (const [model, value] of Object.entries(record)) {
    const row = objectLike(value)
    const inputPer1M = clampNumber(row.inputPer1M, 0, 10_000, 0)
    const outputPer1M = clampNumber(row.outputPer1M, 0, 10_000, 0)
    if (!model.trim()) continue
    next[model] = { inputPer1M, outputPer1M }
  }

  return next
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  const record = objectLike(value)
  const next: Record<string, string> = {}

  for (const [key, recordValue] of Object.entries(record)) {
    if (!key.trim() || typeof recordValue !== 'string') continue
    next[key] = recordValue
  }

  return next
}

function pickPatchShape(patch: unknown, normalized: unknown): unknown {
  if (Array.isArray(patch)) return normalized
  if (!isPlainObject(patch) || !isPlainObject(normalized)) return normalized

  const next: Record<string, unknown> = {}
  for (const key of Object.keys(patch)) {
    if (!(key in normalized)) continue
    next[key] = pickPatchShape(patch[key], normalized[key])
  }

  return next
}

function uniqueSupportedAgents(values: unknown): SupportedAgentId[] {
  const source = Array.isArray(values) ? values : DEFAULT_APP_SETTINGS.agents.enabledAgentIds
  return [...new Set(source.map(migrateLegacyAgentId).filter(isSupportedAgentId))]
}

function normalizeEnabledAgents(values: unknown): SupportedAgentId[] {
  const enabled = uniqueSupportedAgents(values)
  if (enabled.length === 0) return []

  const isLegacyDefault =
    LEGACY_DEFAULT_AGENT_IDS.every((agentId) => enabled.includes(agentId)) &&
    !enabled.includes('antigravity')

  return isLegacyDefault
    ? [...new Set([...enabled, ...DEFAULT_APP_SETTINGS.agents.enabledAgentIds])]
    : enabled
}

function supportedAgentOr(value: unknown, fallback: SupportedAgentId): SupportedAgentId {
  const migrated = migrateLegacyAgentId(value)
  return isSupportedAgentId(migrated) ? migrated : fallback
}

function isSupportedAgentId(value: unknown): value is SupportedAgentId {
  return typeof value === 'string' && SUPPORTED_AGENT_IDS.includes(value as SupportedAgentId)
}

function modelTierOr(value: unknown, fallback: ModelTier): ModelTier {
  return typeof value === 'string' && MODEL_TIERS.includes(value as ModelTier)
    ? (value as ModelTier)
    : fallback
}

function permissionModeOr(value: unknown, fallback: AgentPermissionMode): AgentPermissionMode {
  return typeof value === 'string' && PERMISSION_MODES.includes(value as AgentPermissionMode)
    ? (value as AgentPermissionMode)
    : fallback
}

function swarmStrategyOr(value: unknown, fallback: SwarmTemplate['strategy']): SwarmTemplate['strategy'] {
  return value === 'parallel' || value === 'sequential' || value === 'fan-out'
    ? value
    : fallback
}

function verificationRecipeScopeOr(
  value: unknown,
  fallback: VerificationRecipeScope,
): VerificationRecipeScope {
  return value === 'build' ||
    value === 'test' ||
    value === 'lint' ||
    value === 'ui' ||
    value === 'custom'
    ? value
    : fallback
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, Math.floor(number)))
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, number))
}

function objectLike(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function migrateLegacyAgentId(value: unknown): unknown {
  return value === LEGACY_GEMINI_AGENT_ID ? ANTIGRAVITY_AGENT_ID : value
}

function migrateLegacyGeminiAgent(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(migrateLegacyGeminiAgent)
  }

  if (typeof value === 'string') {
    return migrateLegacyAgentId(value)
  }

  if (!isPlainObject(value)) {
    return value
  }

  const migrated: Record<string, unknown> = {}

  for (const [key, item] of Object.entries(value)) {
    if (key === LEGACY_GEMINI_AGENT_ID) continue
    migrated[key] = migrateLegacyGeminiAgent(item)
  }

  if (Object.hasOwn(value, LEGACY_GEMINI_AGENT_ID)) {
    const legacyValue = migrateLegacyGeminiAgent(value[LEGACY_GEMINI_AGENT_ID])
    migrated[ANTIGRAVITY_AGENT_ID] = Object.hasOwn(migrated, ANTIGRAVITY_AGENT_ID)
      ? mergeLegacyFallback(legacyValue, migrated[ANTIGRAVITY_AGENT_ID])
      : legacyValue
  }

  return migrated
}

function mergeLegacyFallback(fallback: unknown, preferred: unknown): unknown {
  if (!isPlainObject(fallback) || !isPlainObject(preferred)) {
    return preferred ?? fallback
  }

  const merged: Record<string, unknown> = { ...fallback }
  for (const [key, value] of Object.entries(preferred)) {
    merged[key] = Object.hasOwn(merged, key)
      ? mergeLegacyFallback(merged[key], value)
      : value
  }

  return merged
}
