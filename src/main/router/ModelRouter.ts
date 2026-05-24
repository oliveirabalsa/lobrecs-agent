import { MODEL_MAP, SUPPORTED_AGENT_IDS } from '../../shared/types'
import { inferModelTier, pickModelForTier, modelSupportsImages } from '../agents/modelDiscovery'
import { scoreComplexity } from './ComplexityScorer'
import type {
  AgentId,
  AgentModel,
  AppSettings,
  ModelTier,
  RoutingDecision,
  SupportedAgentId,
} from '../../shared/types'
import type { ScoringContext } from './ComplexityScorer'

export interface InstallableAdapter {
  isInstalled(): boolean | Promise<boolean>
  listModels?(): Promise<AgentModel[]>
}

export interface AdapterRegistry {
  get(agentId: SupportedAgentId): InstallableAdapter | undefined
}

export interface ModelRouterOptions {
  adapterRegistry?: AdapterRegistry
  defaultAgentId?: SupportedAgentId
  fallbackAgentId?: SupportedAgentId
  settingsProvider?: (projectId?: string) => AppSettings | Promise<AppSettings>
}

export interface RouteParams {
  prompt: string
  preferredAgentId?: AgentId | string
  requiresImageSupport?: boolean
  modelOverride?: string
  projectId?: string
  recentFailures?: ScoringContext['recentFailures']
  /**
   * When true, the router treats `preferredAgentId` as a tiebreaker rather
   * than a lock — it picks the agent from prompt characteristics and the
   * resolved tier. The renderer sets this when the composer's model
   * selection is `{ kind: 'auto' }`.
   */
  autoAgentSelection?: boolean
}

const TIER_PRIORITY: ModelTier[] = ['frontier', 'advanced', 'balanced', 'lightweight']

export class ModelRouter {
  private readonly adapterRegistry?: AdapterRegistry
  private readonly defaultAgentId: SupportedAgentId
  private readonly fallbackAgentId: SupportedAgentId
  private readonly settingsProvider?: ModelRouterOptions['settingsProvider']

  constructor(options: ModelRouterOptions = {}) {
    this.adapterRegistry = options.adapterRegistry
    this.defaultAgentId = options.defaultAgentId ?? 'opencode'
    this.fallbackAgentId = options.fallbackAgentId ?? 'codex'
    this.settingsProvider = options.settingsProvider
  }

  async route(params: RouteParams): Promise<RoutingDecision> {
    const settings = await this.resolveSettings(params.projectId)
    const enabledAgents = this.enabledAgents(settings)
    const defaultAgentId = enabledAgents.includes(settings.agents.defaultAgentId)
      ? settings.agents.defaultAgentId
      : enabledAgents[0] ?? this.defaultAgentId
    const fallbackAgentId = enabledAgents.includes(settings.agents.fallbackAgentId)
      ? settings.agents.fallbackAgentId
      : defaultAgentId
    const imageSupportRequired = params.requiresImageSupport ?? false
    if (params.modelOverride) {
      const requestedAgentId =
        this.normalizeAgentId(params.preferredAgentId, enabledAgents) ?? defaultAgentId
      let agentId = requestedAgentId

      if (imageSupportRequired && !this.supportsImages(agentId, params.modelOverride)) {
        throw new Error('Manual image-capable model required')
      }

      if (!(await this.isAgentAvailable(agentId))) {
        agentId = imageSupportRequired
          ? await this.firstAvailableImageAwareAgent(enabledAgents, modelTierFromModel(params.modelOverride), settings)
          : await this.firstAvailableAgent([
              fallbackAgentId,
              defaultAgentId,
              ...enabledAgents,
            ], fallbackAgentId)
      }

      const tier = modelTierFromModel(params.modelOverride)
      const model =
        agentId === requestedAgentId
          ? params.modelOverride
          : await this.resolveModelForTier(agentId, tier, settings)

      if (imageSupportRequired && !this.supportsImages(agentId, model)) {
        throw new Error('Manual image-capable model required')
      }

      return {
        agentId,
        model,
        tier,
        score: -1,
        reasoning:
          model === params.modelOverride
            ? 'Manual override'
            : 'Manual override agent unavailable; routed to available adapter',
      }
    }

    const scoring = scoreComplexity(params.prompt, {
      recentFailures: params.recentFailures,
      tierThresholds: settings.routing.tierThresholds,
      securityMinimumTier: settings.routing.securityMinimumTier,
      useRecentFailureEscalation: settings.routing.useRecentFailureEscalation,
    })
    const preferredAgent = this.normalizeAgentId(params.preferredAgentId, enabledAgents)
    let agentId: SupportedAgentId
    if (params.autoAgentSelection) {
      agentId = await this.pickAgentForTier({
        tier: scoring.tier,
        prompt: params.prompt,
        enabledAgents,
        preferredAgent,
        fallbackAgentId,
        defaultAgentId,
      })
    } else {
      agentId = preferredAgent ?? defaultAgentId
    }

    if (imageSupportRequired) {
      const resolvedModel = await this.resolveModelForTier(agentId, scoring.tier, settings)
      if (!this.supportsImages(agentId, resolvedModel)) {
        agentId = await this.firstAvailableImageAwareAgent(enabledAgents, scoring.tier, settings)
      }
    }

    if (!(await this.isAgentAvailable(agentId))) {
      if (imageSupportRequired) {
        agentId = await this.firstAvailableImageAwareAgent(enabledAgents, scoring.tier, settings)
      } else {
        agentId = await this.firstAvailableAgent([
          fallbackAgentId,
          defaultAgentId,
          ...enabledAgents,
        ], fallbackAgentId)
      }
    }

    if (
      scoring.tier === 'frontier' &&
      agentId === 'opencode' &&
      !settings.routing.allowOpenCodeForFrontier
    ) {
      const frontierCandidates = ([
        'codex',
        'claude-code',
        'antigravity',
        ...enabledAgents,
      ] as SupportedAgentId[]).filter((id) => enabledAgents.includes(id))

      agentId = imageSupportRequired
        ? await this.firstAvailableImageAwareAgent(frontierCandidates, scoring.tier, settings)
        : await this.firstAvailableAgent(
            frontierCandidates,
            fallbackAgentId,
          )
    }

    return {
      agentId,
      model: await this.resolveModelForTier(agentId, scoring.tier, settings),
      tier: scoring.tier,
      score: scoring.score,
      reasoning: scoring.reasoning,
    }
  }

  supportsImages(agentId: SupportedAgentId, modelId?: string): boolean {
    if (modelId) {
      return modelSupportsImages(modelId)
    }
    if (agentId === 'claude-code' || agentId === 'codex' || agentId === 'antigravity') {
      return true
    }
    return false
  }

  private normalizeAgentId(
    agentId: AgentId | string | undefined,
    enabledAgents: readonly SupportedAgentId[],
  ): SupportedAgentId | undefined {
    if (isSupportedAgentId(agentId) && enabledAgents.includes(agentId)) {
      return agentId
    }

    return undefined
  }

  private async isAgentAvailable(agentId: SupportedAgentId): Promise<boolean> {
    if (!this.adapterRegistry) {
      return true
    }

    const adapter = this.adapterRegistry.get(agentId)
    if (!adapter) {
      return false
    }

    try {
      return await adapter.isInstalled()
    } catch {
      return false
    }
  }

  /**
   * Picks an agent when AUTO mode is on.
   *
   * Intelligence/cost policy:
   *   - frontier/advanced → Codex first, then Claude Opus, then Gemini, then MiniMax
   *   - balanced/lightweight → MiniMax first because it is cheap enough to use often
   * Claude remains available as a high-quality fallback, but AUTO mode should
   * not burn Opus by default.
   */
  private async pickAgentForTier(params: {
    tier: ModelTier
    prompt: string
    enabledAgents: readonly SupportedAgentId[]
    preferredAgent?: SupportedAgentId
    fallbackAgentId: SupportedAgentId
    defaultAgentId: SupportedAgentId
  }): Promise<SupportedAgentId> {
    const tierPreference: Record<ModelTier, SupportedAgentId[]> = {
      frontier: ['codex', 'claude-code', 'antigravity', 'opencode'],
      advanced: ['codex', 'claude-code', 'antigravity', 'opencode'],
      balanced: ['opencode', 'codex', 'antigravity', 'claude-code'],
      lightweight: ['opencode', 'codex', 'antigravity', 'claude-code'],
    }

    const candidates: SupportedAgentId[] = [
      ...tierPreference[params.tier].filter((id) => params.enabledAgents.includes(id)),
      ...(params.preferredAgent ? [params.preferredAgent] : []),
      params.defaultAgentId,
      params.fallbackAgentId,
      ...params.enabledAgents,
    ]

    return this.firstAvailableAgent(candidates, params.fallbackAgentId)
  }

  private async firstAvailableAgent(
    candidates: SupportedAgentId[],
    fallbackAgentId = this.fallbackAgentId,
  ): Promise<SupportedAgentId> {
    const uniqueCandidates = [...new Set(candidates)]

    for (const agentId of uniqueCandidates) {
      if (await this.isAgentAvailable(agentId)) {
        return agentId
      }
    }

    return fallbackAgentId
  }

  private async firstAvailableImageAwareAgent(
    enabledAgents: readonly SupportedAgentId[] = SUPPORTED_AGENT_IDS,
    tier: ModelTier = 'frontier',
    settings?: AppSettings,
  ): Promise<SupportedAgentId> {
    const priority = ['codex', 'claude-code', 'antigravity', 'opencode'] as SupportedAgentId[]
    for (const agentId of priority) {
      if (!enabledAgents.includes(agentId)) continue
      if (!(await this.isAgentAvailable(agentId))) continue

      const model = await this.resolveModelForTier(agentId, tier, settings)
      if (this.supportsImages(agentId, model)) {
        return agentId
      }
    }

    throw new Error('Image-capable model required')
  }

  private async resolveModelForTier(
    agentId: SupportedAgentId,
    tier: ModelTier,
    settings?: AppSettings,
  ): Promise<string> {
    const adapter = this.adapterRegistry?.get(agentId)

    if (adapter?.listModels) {
      try {
        const models = await adapter.listModels()
        const mappedModel = getModelForTier(agentId, tier, settings)
        if (models.some((model) => model.id === mappedModel)) return mappedModel

        const model = pickModelForTier(models, tier)
        if (model) return model.id
      } catch {
        // Fall back to the static map when local model discovery fails.
      }
    }

    return getModelForTier(agentId, tier, settings)
  }

  private enabledAgents(settings: AppSettings): SupportedAgentId[] {
    const enabled = settings.agents.enabledAgentIds.filter((agentId) => {
      const runtime = settings.agents.runtimes[agentId]
      return runtime?.enabled !== false
    })

    return enabled.length > 0 ? enabled : [this.defaultAgentId]
  }

  private async resolveSettings(projectId?: string): Promise<AppSettings> {
    return this.settingsProvider?.(projectId) ?? fallbackSettings()
  }
}

export function getModelForTier(
  agentId: SupportedAgentId,
  tier: ModelTier,
  settings?: Pick<AppSettings, 'agents'>,
): string {
  return (
    settings?.agents.modelMap[agentId]?.[tier] ??
    MODEL_MAP[agentId]?.[tier] ??
    MODEL_MAP['claude-code'][tier]
  )
}

export function modelTierFromModel(model: string): ModelTier {
  for (const tier of TIER_PRIORITY) {
    for (const agentId of SUPPORTED_AGENT_IDS) {
      if (MODEL_MAP[agentId][tier] === model) {
        return tier
      }
    }
  }

  return inferModelTier(model)
}

function isSupportedAgentId(agentId?: AgentId | string): agentId is SupportedAgentId {
  return typeof agentId === 'string' && Object.hasOwn(MODEL_MAP, agentId)
}

export const modelRouter = new ModelRouter()

function fallbackSettings(): AppSettings {
  return {
    schemaVersion: 1,
    general: {
      appName: 'Lobrecs Agent',
      startOnLaunch: false,
      openLastProjectOnLaunch: true,
      enableDesktopNotifications: true,
      onlyWhenUnfocused: true,
      notificationEvents: {
        swarmCompleted: true,
        diffReady: true,
        automationSuccess: true,
        automationFailure: true,
        sessionError: true,
      },
    },
    agents: {
      defaultAgentId: 'opencode',
      fallbackAgentId: 'codex',
      enabledAgentIds: [...SUPPORTED_AGENT_IDS],
      runtimes: {
        'claude-code': {
          enabled: true,
          command: '',
          permissionMode: 'dangerous',
          extraArgs: [],
        },
        codex: {
          enabled: true,
          command: '',
          permissionMode: 'dangerous',
          extraArgs: [],
        },
        opencode: {
          enabled: true,
          command: '',
          permissionMode: 'dangerous',
          extraArgs: [],
        },
        antigravity: {
          enabled: true,
          command: '',
          permissionMode: 'dangerous',
          extraArgs: [],
        },
      },
      modelMap: {
        'claude-code': { ...MODEL_MAP['claude-code'] },
        codex: { ...MODEL_MAP.codex },
        opencode: { ...MODEL_MAP.opencode },
        antigravity: { ...MODEL_MAP.antigravity },
      },
      imageAttachments: { maxCount: 8, maxSizeMb: 20 },
    },
    routing: {
      tierThresholds: { lightweightMax: 30, balancedMax: 65, advancedMax: 85 },
      securityMinimumTier: 'advanced',
      allowOpenCodeForFrontier: false,
      useRecentFailureEscalation: true,
    },
    execution: {
      worktreeIsolation: false,
      autoApplyCompletedDiffs: true,
      defaultApprovalMode: 'dangerous',
      maxQueuedMessagesPerThread: 20,
      commandPrefix: 'rtk',
      warnWhenCommandMissingPrefix: true,
      sessionOutputRetentionDays: 30,
    },
    swarms: {
      defaultStrategy: 'managed',
      maxAgents: 8,
      maxReviewerIterations: 3,
      defaultAgents: [],
      rolePrompts: {},
      templates: [],
    },
    specs: {
      defaultAgentIds: ['codex'],
      defaultRunMode: 'local',
      defaultVerificationRecipeIds: ['build', 'test'],
      targetFileLimit: 12,
      requireApprovalBeforeRun: true,
    },
    verification: {
      recipes: [],
      requireCommandPrefix: true,
      maxOutputBytes: 512_000,
      defaultTimeoutSeconds: 120,
      autoRunAfterAgentDiffs: true,
      selfHealingMaxAttempts: 1,
    },
    costs: {
      currency: 'USD',
      monthlyBudgetUsd: 50,
      warnAtPercent: 80,
      pricing: {},
    },
    ui: {
      compactMode: false,
      sidebarDefaultWidth: 260,
      rightPanelDefaultOpen: false,
      rightPanelDefaultMode: 'diff',
      terminalDefaultHeight: 260,
      showCostBadges: true,
      showTokenCounts: true,
    },
    editor: {
      defaultEditorId: '',
      cliEditorId: 'shell',
      fontSize: 13,
      tabSize: 2,
      wordWrap: true,
      formatOnSave: false,
    },
  }
}
