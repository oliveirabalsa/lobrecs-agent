import { MODEL_MAP, SUPPORTED_AGENT_IDS } from '../../shared/types'
import { inferModelTier, pickModelForTier } from '../agents/modelDiscovery'
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
}

const TIER_PRIORITY: ModelTier[] = ['frontier', 'advanced', 'balanced', 'lightweight']

export class ModelRouter {
  private readonly adapterRegistry?: AdapterRegistry
  private readonly defaultAgentId: SupportedAgentId
  private readonly fallbackAgentId: SupportedAgentId
  private readonly settingsProvider?: ModelRouterOptions['settingsProvider']

  constructor(options: ModelRouterOptions = {}) {
    this.adapterRegistry = options.adapterRegistry
    this.defaultAgentId = options.defaultAgentId ?? 'claude-code'
    this.fallbackAgentId = options.fallbackAgentId ?? 'claude-code'
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

      if (imageSupportRequired && !this.supportsImages(agentId)) {
        throw new Error('Manual image-capable model required')
      }

      if (!(await this.isAgentAvailable(agentId))) {
        agentId = imageSupportRequired
          ? await this.firstAvailableImageAwareAgent(enabledAgents)
          : await this.firstAvailableAgent([
              fallbackAgentId,
              defaultAgentId,
              ...enabledAgents,
            ], fallbackAgentId)
      }

      if (imageSupportRequired && !this.supportsImages(agentId)) {
        throw new Error('Manual image-capable model required')
      }

      const tier = modelTierFromModel(params.modelOverride)
      const model =
        agentId === requestedAgentId
          ? params.modelOverride
          : await this.resolveModelForTier(agentId, tier, settings)

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
    let agentId = this.normalizeAgentId(params.preferredAgentId, enabledAgents) ?? defaultAgentId

    if (imageSupportRequired && !this.supportsImages(agentId)) {
      agentId = await this.firstAvailableImageAwareAgent(enabledAgents)
    }

    if (!(await this.isAgentAvailable(agentId))) {
      agentId = await this.firstAvailableAgent([
        fallbackAgentId,
        defaultAgentId,
        ...enabledAgents,
      ], fallbackAgentId)
    }

    if (
      scoring.tier === 'frontier' &&
      agentId === 'opencode' &&
      !settings.routing.allowOpenCodeForFrontier
    ) {
      const frontierCandidates = ([
        'claude-code',
        'codex',
        ...enabledAgents,
      ] as SupportedAgentId[]).filter((id) => enabledAgents.includes(id))

      agentId = await this.firstAvailableAgent(
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

  private supportsImages(agentId: SupportedAgentId): boolean {
    return agentId === 'claude-code' || agentId === 'codex'
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
  ): Promise<SupportedAgentId> {
    for (const agentId of ['claude-code', 'codex'] as SupportedAgentId[]) {
      if (!enabledAgents.includes(agentId)) continue
      if (await this.isAgentAvailable(agentId)) return agentId
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
      checkForUpdates: true,
    },
    agents: {
      defaultAgentId: 'claude-code',
      fallbackAgentId: 'claude-code',
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
      defaultStrategy: 'parallel',
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
