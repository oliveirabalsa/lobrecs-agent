import { MODEL_MAP, SUPPORTED_AGENT_IDS } from '../../shared/types'
import { inferModelTier, pickModelForTier, modelSupportsImages } from '../agents/modelDiscovery'
import { DEFAULT_APP_SETTINGS } from '../modules/settings'
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
  minimumTier?: ModelTier
  agentPreference?: SupportedAgentId[]
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

      const tier = modelTierFromModel(params.modelOverride)
      if (!(await this.isAgentAvailable(agentId))) {
        agentId = imageSupportRequired
          ? await this.firstAvailableImageAwareAgent(enabledAgents, modelTierFromModel(params.modelOverride), settings)
          : await this.firstAvailableAgent([
              fallbackAgentId,
              defaultAgentId,
              ...enabledAgents,
            ], fallbackAgentId)
      }

      const resolvedModel =
        agentId === requestedAgentId
          ? await this.resolveModelOverrideForAgent(agentId, params.modelOverride, tier)
          : {
              model: await this.resolveModelForTier(agentId, tier, settings),
              exact: false,
            }
      const model = resolvedModel.model
      const exactModelMatch = resolvedModel.exact

      if (imageSupportRequired && !this.supportsImages(agentId, model)) {
        throw new Error('Manual image-capable model required')
      }

      return {
        agentId,
        model,
        tier,
        score: -1,
        reasoning:
          exactModelMatch
            ? 'Manual override'
            : agentId === requestedAgentId
              ? 'Manual override not found in model catalog; routed to available model for requested tier'
            : 'Manual override agent unavailable; routed to available adapter',
      }
    }

    const scoring = applyMinimumTier(
      scoreComplexity(params.prompt, {
        recentFailures: params.recentFailures,
        tierThresholds: settings.routing.tierThresholds,
        securityMinimumTier: settings.routing.securityMinimumTier,
        useRecentFailureEscalation: settings.routing.useRecentFailureEscalation,
      }),
      params.minimumTier,
    )
    const preferredAgent = this.normalizeAgentId(params.preferredAgentId, enabledAgents)
    let agentId: SupportedAgentId
    if (params.autoAgentSelection) {
      agentId = await this.pickAgentForTier({
        tier: scoring.tier,
        prompt: params.prompt,
        enabledAgents,
        preferredAgent,
        agentPreference: params.agentPreference,
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
        'cursor',
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
    if (agentId === 'cursor') {
      return false
    }
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
    agentPreference?: readonly SupportedAgentId[]
    fallbackAgentId: SupportedAgentId
    defaultAgentId: SupportedAgentId
  }): Promise<SupportedAgentId> {
    const tierPreference: Record<ModelTier, SupportedAgentId[]> = {
      frontier: ['codex', 'claude-code', 'antigravity', 'cursor', 'opencode'],
      advanced: ['codex', 'claude-code', 'antigravity', 'cursor', 'opencode'],
      balanced: ['opencode', 'codex', 'cursor', 'antigravity', 'claude-code'],
      lightweight: ['opencode', 'codex', 'cursor', 'antigravity', 'claude-code'],
    }

    const candidates: SupportedAgentId[] = [
      ...(params.agentPreference ?? []).filter((id) => params.enabledAgents.includes(id)),
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
        const authoritativeModels = authoritativeCatalogModels(models)
        const mappedModel = getModelForTier(agentId, tier, settings)
        if (authoritativeModels.some((model) => model.id === mappedModel)) return mappedModel

        const model = pickModelForTier(authoritativeModels, tier)
        if (model) return model.id
      } catch {
        // Fall back to the static map when local model discovery fails.
      }
    }

    return getModelForTier(agentId, tier, settings)
  }

  private async resolveModelOverrideForAgent(
    agentId: SupportedAgentId,
    requestedModel: string,
    tier: ModelTier,
  ): Promise<{ model: string; exact: boolean }> {
    const adapter = this.adapterRegistry?.get(agentId)

    if (adapter?.listModels) {
      try {
        const models = authoritativeCatalogModels(await adapter.listModels())
        if (models.some((model) => model.id === requestedModel)) {
          return { model: requestedModel, exact: true }
        }

        const model = pickModelForTier(models, tier)
        if (model) return { model: model.id, exact: false }
      } catch {
        // Preserve manual override compatibility when local model discovery fails.
      }
    }

    return { model: requestedModel, exact: true }
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

function authoritativeCatalogModels(models: AgentModel[]): AgentModel[] {
  const authoritative = models.filter(
    (model) => model.source === 'api' || model.source === 'cli' || model.source === 'config',
  )
  return authoritative.length > 0 ? authoritative : models
}

function isSupportedAgentId(agentId?: AgentId | string): agentId is SupportedAgentId {
  return typeof agentId === 'string' && Object.hasOwn(MODEL_MAP, agentId)
}

function applyMinimumTier<T extends { tier: ModelTier; reasoning: string }>(
  scoring: T,
  minimumTier: ModelTier | undefined,
): T {
  if (!minimumTier) return scoring

  const currentRank = TIER_PRIORITY.indexOf(scoring.tier)
  const minimumRank = TIER_PRIORITY.indexOf(minimumTier)
  if (currentRank <= minimumRank) return scoring

  return {
    ...scoring,
    tier: minimumTier,
    reasoning: `${scoring.reasoning}; raised to ${minimumTier} by routing minimum`,
  }
}

export const modelRouter = new ModelRouter()

function fallbackSettings(): AppSettings {
  return structuredClone(DEFAULT_APP_SETTINGS)
}
