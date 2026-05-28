import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { MODEL_MAP, OPENCODE_MINIMAX_TOKEN_PLAN_PROVIDER } from '../../shared/types'
import type {
  AgentModel,
  AgentThinkingLevel,
  ModelTier,
  SupportedAgentId,
} from '../../shared/types'

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g
const CLAUDE_MODEL_PATTERN = /^claude-[a-z0-9-]+$/i
const TIER_ORDER: ModelTier[] = ['lightweight', 'balanced', 'advanced', 'frontier']
const ANTHROPIC_MODELS_TIMEOUT_MS = 5000

const CLAUDE_FALLBACK_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
  'claude-opus-4-7',
]

const FALLBACK_MODELS_BY_AGENT: Partial<Record<SupportedAgentId, readonly string[]>> = {
  antigravity: [
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash',
    'gemini-3.0-pro',
    'gemini-3.1-pro',
    'gemini-3.5-flash',
  ],
  cursor: ['auto', 'gpt-5', 'sonnet-4', 'sonnet-4-thinking'],
}

const CLAUDE_THINKING_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const CODEX_THINKING_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const
const SUPPORTED_THINKING_LEVELS = new Set<string>([
  ...CLAUDE_THINKING_LEVELS,
  ...CODEX_THINKING_LEVELS,
])

export function fallbackModelsForAgent(agentId: SupportedAgentId): AgentModel[] {
  const mappedModels = FALLBACK_MODELS_BY_AGENT[agentId] ?? Object.values(MODEL_MAP[agentId])
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
        const supportedThinkingLevels = parseSupportedThinkingLevels(
          record.supported_reasoning_levels,
        )
        const defaultThinkingLevel = parseThinkingLevel(record.default_reasoning_level)

        return [
          createAgentModel('codex', id, 'cli', {
            label,
            description,
            supportedThinkingLevels,
            defaultThinkingLevel,
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
    .filter((id) => {
      // Filter out non-token-plan MiniMax providers
      // Keep: minimax-coding-plan/*, exclude: opencode/minimax*, minimax/*, minimax-cn-coding-plan/*
      if (id.startsWith('opencode/minimax') ||
          id.startsWith('minimax/') ||
          id.startsWith('minimax-cn-coding-plan/')) {
        return false
      }
      return true
    })

  return dedupeModels(
    ids.map((id) => createAgentModel('opencode', id, 'cli', {
      label: labelForOpenCodeModel(id),
    }))
  )
}

export function parseClaudeCliModels(output: string): AgentModel[] {
  const jsonModels = parseAnthropicModelsResponse(parseJsonOrUndefined(output), 'cli')
  if (jsonModels.length > 0) return jsonModels

  const models = output
    .replace(ANSI_PATTERN, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = line.match(/(?:^|\s)(claude-[a-z0-9][a-z0-9-]*)(?:\s+-\s+(.+))?$/i)
      if (!match) return []

      const [, id, label] = match
      return [
        createAgentModel('claude-code', id, 'cli', {
          ...(label ? { label: label.trim() } : {}),
        }),
      ]
    })

  return dedupeModels(models)
}

export async function fetchAnthropicApiModels(
  apiKey: string,
  baseUrl = 'https://api.anthropic.com',
): Promise<AgentModel[]> {
  if (!apiKey.trim() || typeof fetch !== 'function') return []

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ANTHROPIC_MODELS_TIMEOUT_MS)

  try {
    const response = await fetch(anthropicModelsUrl(baseUrl), {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
      signal: controller.signal,
    })

    if (!response.ok) return []
    return parseAnthropicModelsResponse(await response.json(), 'api')
  } finally {
    clearTimeout(timeout)
  }
}

export function parseAnthropicModelsResponse(
  value: unknown,
  source: Extract<AgentModel['source'], 'api' | 'cli'> = 'api',
): AgentModel[] {
  const records = modelRecords(value)

  return dedupeModels(
    records.flatMap((entry) => {
      if (typeof entry === 'string') {
        const id = entry.trim()
        return CLAUDE_MODEL_PATTERN.test(id)
          ? [createAgentModel('claude-code', id, source)]
          : []
      }
      if (!entry || typeof entry !== 'object') return []

      const record = entry as Record<string, unknown>
      const id = typeof record.id === 'string' ? record.id.trim() : ''
      if (!CLAUDE_MODEL_PATTERN.test(id)) return []
      if (typeof record.type === 'string' && record.type !== 'model') return []

      const label = stringField(record, 'display_name') ??
        stringField(record, 'displayName') ??
        stringField(record, 'name')

      return [
        createAgentModel('claude-code', id, source, {
          ...(label ? { label } : {}),
        }),
      ]
    }),
  )
}

export function isOpenCodeMiniMaxTokenPlanModel(id: string): boolean {
  return id.startsWith(OPENCODE_MINIMAX_TOKEN_PLAN_PROVIDER)
}

function labelForOpenCodeModel(id: string): string {
  if (id.startsWith('minimax-coding-plan/')) {
    return `${id.slice('minimax-coding-plan/'.length)} (MiniMax Token Plan)`
  }
  if (id.startsWith('minimax-cn-coding-plan/')) {
    return `${id.slice('minimax-cn-coding-plan/'.length)} (MiniMax CN)`
  }
  if (id.startsWith('opencode/')) {
    return id.slice('opencode/'.length)
  }
  return id
}

export function createAgentModel(
  agentId: SupportedAgentId,
  id: string,
  source: AgentModel['source'],
  overrides: Partial<
    Pick<
      AgentModel,
      'label' | 'description' | 'tier' | 'defaultThinkingLevel' | 'supportedThinkingLevels'
    >
  > = {},
): AgentModel {
  const supportedThinkingLevels =
    overrides.supportedThinkingLevels ?? defaultThinkingLevelsForAgent(agentId, id)
  const defaultThinkingLevel =
    overrides.defaultThinkingLevel ?? defaultThinkingLevelForAgent(agentId, id)

  return {
    id,
    label: overrides.label ?? labelForModelId(id),
    agentId,
    tier: overrides.tier ?? inferModelTier(id, overrides.label),
    source,
    description: overrides.description,
    ...(defaultThinkingLevel ? { defaultThinkingLevel } : {}),
    ...(supportedThinkingLevels?.length ? { supportedThinkingLevels } : {}),
  }
}

function parseSupportedThinkingLevels(
  value: unknown,
): Array<Exclude<AgentThinkingLevel, 'off'>> | undefined {
  if (!Array.isArray(value)) return undefined

  const levels = value.flatMap((entry) => {
    const effort = typeof entry === 'string'
      ? entry
      : entry && typeof entry === 'object'
        ? (entry as Record<string, unknown>).effort
        : undefined
    const parsed = parseThinkingLevel(effort)
    return parsed ? [parsed] : []
  })

  return levels.length > 0 ? levels : undefined
}

function parseThinkingLevel(value: unknown): Exclude<AgentThinkingLevel, 'off'> | undefined {
  if (typeof value !== 'string') return undefined
  return SUPPORTED_THINKING_LEVELS.has(value)
    ? (value as Exclude<AgentThinkingLevel, 'off'>)
    : undefined
}

function defaultThinkingLevelsForAgent(
  agentId: SupportedAgentId,
  _modelId: string,
): Array<Exclude<AgentThinkingLevel, 'off'>> | undefined {
  if (agentId === 'claude-code') return [...CLAUDE_THINKING_LEVELS]
  if (agentId === 'codex') return [...CODEX_THINKING_LEVELS]
  return undefined
}

function defaultThinkingLevelForAgent(
  agentId: SupportedAgentId,
  modelId: string,
): Exclude<AgentThinkingLevel, 'off'> | undefined {
  if (agentId === 'claude-code') return 'medium'
  if (agentId !== 'codex') return undefined
  return modelId.includes('spark') ? 'high' : 'medium'
}

function labelForModelId(id: string): string {
  if (id === 'auto') return 'Auto'
  if (id === 'opus') return 'opus (latest Opus, currently 4.8)'
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
  const normalized = `${id} ${label}`.trim().toLowerCase()

  if (normalized === 'auto') {
    return 'frontier'
  }

  if (normalized.includes('gpt-5.5') || normalized.includes('opus')) {
    return 'frontier'
  }

  if (
    normalized.includes('gemini-3.5') ||
    normalized.includes('antigravity-3.5')
  ) {
    return normalized.includes('flash') ? 'frontier' : 'advanced'
  }

  if (normalized.includes('gemini-3.0') || normalized.includes('antigravity-3.0')) {
    return normalized.includes('flash') ? 'balanced' : 'advanced'
  }

  if (normalized.includes('gemini-3.1') || normalized.includes('antigravity-3.1')) {
    return normalized.includes('flash') ? 'balanced' : 'advanced'
  }

  if (normalized.includes('gemini-3') || normalized.includes('antigravity-3')) {
    return 'frontier'
  }

  if (normalized.includes('flash-lite')) {
    return 'lightweight'
  }

  if (
    normalized.includes('gemini-2.5-pro') ||
    normalized.includes('antigravity-2.5-pro') ||
    normalized.includes('gemini-pro') ||
    normalized.includes('antigravity-pro') ||
    normalized === 'pro'
  ) {
    return 'advanced'
  }

  if (
    normalized.includes('gemini-2.5-flash') ||
    normalized.includes('antigravity-2.5-flash') ||
    normalized.includes('gemini-flash') ||
    normalized.includes('antigravity-flash') ||
    normalized === 'flash'
  ) {
    return 'balanced'
  }

  for (const tiers of Object.values(MODEL_MAP) as Array<Record<ModelTier, string>>) {
    for (const tier of TIER_ORDER) {
      if (tiers[tier] === id) return tier
    }
  }

  if (normalized.includes('spark')) {
    return 'lightweight'
  }

  if (normalized.includes('m2.7')) {
    return 'advanced'
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

function parseJsonOrUndefined(output: string): unknown {
  try {
    return JSON.parse(output)
  } catch {
    return undefined
  }
}

function modelRecords(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value

  const record = value as Record<string, unknown>
  if (Array.isArray(record.data)) return record.data
  if (Array.isArray(record.models)) return record.models

  return []
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function anthropicModelsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '') || 'https://api.anthropic.com'
  return normalized.endsWith('/v1') ? `${normalized}/models` : `${normalized}/v1/models`
}

export function modelSupportsImages(modelId: string): boolean {
  const normalized = modelId.toLowerCase()

  // Gemini & Antigravity models (always support images)
  if (normalized.includes('gemini') || normalized.includes('antigravity')) {
    return true
  }

  // Claude models (Claude 3, 3.5, 4, etc. support images)
  if (
    normalized.includes('claude-3') ||
    normalized.includes('claude-4') ||
    normalized.includes('claude-opus') ||
    normalized.includes('claude-sonnet') ||
    normalized.includes('claude-haiku')
  ) {
    return true
  }
  // Claude Code fallbacks like 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'
  if (/^claude-(haiku|sonnet|opus)/i.test(modelId)) {
    return true
  }

  // OpenAI models (GPT-4, GPT-4o, GPT-5, etc. support images/vision)
  if (
    normalized.includes('gpt-4') ||
    normalized.includes('gpt-5') ||
    normalized.includes('gpt-o')
  ) {
    return true
  }

  // Generic vision/multimodal indicators (common in open source/OpenCode catalog)
  if (
    normalized.includes('vision') ||
    normalized.includes('vl') ||
    normalized.includes('multimodal')
  ) {
    return true
  }

  return false
}
