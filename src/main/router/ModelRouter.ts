import { MODEL_MAP } from '../../shared/types'
import { inferModelTier, pickModelForTier } from '../agents/modelDiscovery'
import { scoreComplexity } from './ComplexityScorer'
import type {
  AgentId,
  AgentModel,
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
}

export interface RouteParams {
  prompt: string
  preferredAgentId?: AgentId | string
  modelOverride?: string
  recentFailures?: ScoringContext['recentFailures']
}

const SUPPORTED_AGENT_IDS = Object.keys(MODEL_MAP) as SupportedAgentId[]
const TIER_PRIORITY: ModelTier[] = ['frontier', 'advanced', 'balanced', 'lightweight']

export class ModelRouter {
  private readonly adapterRegistry?: AdapterRegistry
  private readonly defaultAgentId: SupportedAgentId
  private readonly fallbackAgentId: SupportedAgentId

  constructor(options: ModelRouterOptions = {}) {
    this.adapterRegistry = options.adapterRegistry
    this.defaultAgentId = options.defaultAgentId ?? 'claude-code'
    this.fallbackAgentId = options.fallbackAgentId ?? 'claude-code'
  }

  async route(params: RouteParams): Promise<RoutingDecision> {
    if (params.modelOverride) {
      const agentId = this.normalizeAgentId(params.preferredAgentId) ?? this.defaultAgentId

      return {
        agentId,
        model: params.modelOverride,
        tier: modelTierFromModel(params.modelOverride),
        score: -1,
        reasoning: 'Manual override',
      }
    }

    const scoring = scoreComplexity(params.prompt, {
      recentFailures: params.recentFailures,
    })
    let agentId = this.normalizeAgentId(params.preferredAgentId) ?? this.defaultAgentId

    if (!(await this.isAgentAvailable(agentId))) {
      agentId = await this.firstAvailableAgent([this.fallbackAgentId, this.defaultAgentId])
    }

    if (scoring.tier === 'frontier' && agentId === 'opencode') {
      agentId = await this.firstAvailableAgent(['claude-code', 'codex'])
    }

    return {
      agentId,
      model: await this.resolveModelForTier(agentId, scoring.tier),
      tier: scoring.tier,
      score: scoring.score,
      reasoning: scoring.reasoning,
    }
  }

  private normalizeAgentId(agentId?: AgentId | string): SupportedAgentId | undefined {
    if (isSupportedAgentId(agentId)) {
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

  private async firstAvailableAgent(candidates: SupportedAgentId[]): Promise<SupportedAgentId> {
    const uniqueCandidates = [...new Set(candidates)]

    for (const agentId of uniqueCandidates) {
      if (await this.isAgentAvailable(agentId)) {
        return agentId
      }
    }

    return this.fallbackAgentId
  }

  private async resolveModelForTier(
    agentId: SupportedAgentId,
    tier: ModelTier,
  ): Promise<string> {
    const adapter = this.adapterRegistry?.get(agentId)

    if (adapter?.listModels) {
      try {
        const models = await adapter.listModels()
        const mappedModel = getModelForTier(agentId, tier)
        if (models.some((model) => model.id === mappedModel)) return mappedModel

        const model = pickModelForTier(models, tier)
        if (model) return model.id
      } catch {
        // Fall back to the static map when local model discovery fails.
      }
    }

    return getModelForTier(agentId, tier)
  }
}

export function getModelForTier(agentId: SupportedAgentId, tier: ModelTier): string {
  return MODEL_MAP[agentId]?.[tier] ?? MODEL_MAP['claude-code'][tier]
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
