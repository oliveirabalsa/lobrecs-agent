import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { MODEL_MAP } from '../../shared/types'
import type { AgentModel, ModelTier, SupportedAgentId } from '../../shared/types'

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g
const CLAUDE_MODEL_PATTERN = /^claude-[a-z0-9-]+$/i
const TIER_ORDER: ModelTier[] = ['lightweight', 'balanced', 'advanced', 'frontier']

const CLAUDE_FALLBACK_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
]

export function fallbackModelsForAgent(agentId: SupportedAgentId): AgentModel[] {
  const mappedModels = Object.values(MODEL_MAP[agentId])
  const ids = agentId === 'claude-code'
    ? [...mappedModels, ...CLAUDE_FALLBACK_MODELS]
    : mappedModels

  return dedupeModels(
    ids.map((id) => createAgentModel(agentId, id, 'fallback')),
  )
}

export async function readClaudeHistoryModels(): Promise<AgentModel[]> {
  const statsPath = path.join(homedir(), '.claude', 'stats-cache.json')

  try {
    const parsed = JSON.parse(await readFile(statsPath, 'utf-8')) as unknown
    const ids = new Set<string>()
    collectClaudeModelIds(parsed, ids)

    return [...ids].map((id) => createAgentModel('claude-code', id, 'history'))
  } catch {
    return []
  }
}

export function parseCodexModels(output: string): AgentModel[] {
  try {
    const parsed = JSON.parse(output) as { models?: unknown }
    const models = Array.isArray(parsed.models) ? parsed.models : []

    return dedupeModels(
      models.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []

        const record = entry as Record<string, unknown>
        const id = typeof record.slug === 'string' ? record.slug : ''
        if (!id || record.visibility === 'hidden') return []

        const label = typeof record.display_name === 'string' ? record.display_name : id
        const description =
          typeof record.description === 'string' ? record.description : undefined

        return [
          createAgentModel('codex', id, 'cli', {
            label,
            description,
          }),
        ]
      }),
    )
  } catch {
    return []
  }
}

export function parseOpenCodeModels(output: string): AgentModel[] {
  const ids = output
    .split(/\r?\n/)
    .map((line) => line.replace(ANSI_PATTERN, '').trim())
    .filter((line) => line.includes('/') && !line.includes(' '))

  return dedupeModels(ids.map((id) => createAgentModel('opencode', id, 'cli')))
}

export function createAgentModel(
  agentId: SupportedAgentId,
  id: string,
  source: AgentModel['source'],
  overrides: Partial<Pick<AgentModel, 'label' | 'description' | 'tier'>> = {},
): AgentModel {
  return {
    id,
    label: overrides.label ?? labelForModelId(id),
    agentId,
    tier: overrides.tier ?? inferModelTier(id, overrides.label),
    source,
    description: overrides.description,
  }
}

function labelForModelId(id: string): string {
  if (id === 'opus') return 'opus (latest Opus, currently 4.7)'
  if (id === 'sonnet') return 'sonnet (latest Sonnet)'
  if (id === 'haiku') return 'haiku (latest Haiku)'
  return id
}

export function dedupeModels(models: AgentModel[]): AgentModel[] {
  const seen = new Set<string>()
  const result: AgentModel[] = []

  for (const model of models) {
    const key = `${model.agentId}:${model.id}`
    if (seen.has(key)) continue

    seen.add(key)
    result.push(model)
  }

  return result
}

export function pickModelForTier(
  models: AgentModel[],
  tier: ModelTier,
): AgentModel | undefined {
  const targetRank = TIER_ORDER.indexOf(tier)
  const exact = models.find((model) => model.tier === tier)
  if (exact) return exact

  return [...models].sort((left, right) => {
    const leftDistance = Math.abs(TIER_ORDER.indexOf(left.tier) - targetRank)
    const rightDistance = Math.abs(TIER_ORDER.indexOf(right.tier) - targetRank)
    if (leftDistance !== rightDistance) return leftDistance - rightDistance

    return TIER_ORDER.indexOf(right.tier) - TIER_ORDER.indexOf(left.tier)
  })[0]
}

export function inferModelTier(id: string, label = ''): ModelTier {
  const normalized = `${id} ${label}`.toLowerCase()

  if (normalized.includes('gpt-5.5') || normalized.includes('opus')) {
    return 'frontier'
  }

  if (normalized.includes('spark')) {
    return 'lightweight'
  }

  if (normalized.includes('m2.7')) {
    return 'advanced'
  }

  for (const tiers of Object.values(MODEL_MAP) as Array<Record<ModelTier, string>>) {
    for (const tier of TIER_ORDER) {
      if (tiers[tier] === id) return tier
    }
  }

  if (
    normalized.includes('haiku') ||
    normalized.includes('mini') ||
    normalized.includes('flash') ||
    normalized.includes('free') ||
    normalized.includes('highspeed')
  ) {
    return 'lightweight'
  }

  if (normalized.includes('gpt-5.5') || normalized.includes('opus')) {
    return 'frontier'
  }

  if (
    normalized.includes('sonnet') ||
    normalized.includes('gpt-5.4') ||
    normalized.includes('m2.7') ||
    normalized.includes('advanced') ||
    normalized.includes('high')
  ) {
    return 'advanced'
  }

  return 'balanced'
}

function collectClaudeModelIds(value: unknown, output: Set<string>): void {
  if (typeof value === 'string') {
    if (CLAUDE_MODEL_PATTERN.test(value)) output.add(value)
    return
  }

  if (!value || typeof value !== 'object') return

  if (Array.isArray(value)) {
    for (const item of value) {
      collectClaudeModelIds(item, output)
    }
    return
  }

  for (const [key, item] of Object.entries(value)) {
    if (CLAUDE_MODEL_PATTERN.test(key)) output.add(key)
    collectClaudeModelIds(item, output)
  }
}
