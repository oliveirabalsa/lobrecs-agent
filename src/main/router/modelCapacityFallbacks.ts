import { MODEL_MAP } from '../../shared/types'
import { modelSupportsImages } from '../agents/modelDiscovery'
import { modelTierFromModel } from './ModelRouter'
import type { AppSettings, ModelTier, SupportedAgentId } from '../../shared/types'

const FALLBACK_TIER_ORDER: Record<ModelTier, ModelTier[]> = {
  frontier: ['advanced', 'balanced', 'lightweight'],
  advanced: ['balanced', 'frontier', 'lightweight'],
  balanced: ['advanced', 'lightweight', 'frontier'],
  lightweight: ['balanced', 'advanced', 'frontier'],
}

export function capacityFallbackModelsForAgent(input: {
  settings: AppSettings
  agentId: SupportedAgentId
  currentModel: string
  requiresImageSupport?: boolean
  max?: number
}): string[] {
  const currentTier = modelTierFromModel(input.currentModel)
  const modelMap = input.settings.agents.modelMap[input.agentId] ?? MODEL_MAP[input.agentId]
  const seen = new Set([input.currentModel])
  const models: string[] = []

  for (const tier of FALLBACK_TIER_ORDER[currentTier]) {
    const model = modelMap[tier]
    if (!model || seen.has(model)) continue
    if (input.requiresImageSupport && !modelSupportsImages(model)) continue

    seen.add(model)
    models.push(model)
    if (models.length >= (input.max ?? 3)) break
  }

  return models
}
