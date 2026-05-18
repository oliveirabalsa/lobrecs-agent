import type {
  AgentModelCatalog,
  SupportedAgentId,
  SwarmAgentConfig,
} from '../../../shared/types'

const AGENT_NAMES: Record<SupportedAgentId, string> = {
  'claude-code': 'Claude Code',
  codex: 'OpenAI Codex',
  opencode: 'OpenCode',
}

const DEFAULT_SWARM_ROLES = ['implementer', 'reviewer'] as const

export const DEFAULT_SWARM_AGENT_IDS: SupportedAgentId[] = [
  'claude-code',
  'codex',
  'opencode',
]

export const DEFAULT_SWARM_MODEL_CATALOGS: AgentModelCatalog[] =
  DEFAULT_SWARM_AGENT_IDS.map((agentId) => ({
    agentId,
    name: AGENT_NAMES[agentId],
    installed: true,
    models: [],
  }))

export interface ResolveAvailableSwarmAgentsInput {
  modelCatalogs: readonly AgentModelCatalog[]
  fallbackAgents: readonly SupportedAgentId[]
  catalogsLoaded: boolean
}

export interface NormalizeSwarmAgentsOptions {
  spreadDuplicates?: boolean
}

export function resolveAvailableSwarmAgents({
  modelCatalogs,
  fallbackAgents,
  catalogsLoaded,
}: ResolveAvailableSwarmAgentsInput): SupportedAgentId[] {
  if (catalogsLoaded) {
    return dedupeAgentIds(
      modelCatalogs
        .filter((catalog) => catalog.installed)
        .map((catalog) => catalog.agentId),
    )
  }

  return fallbackAgents.length > 0
    ? dedupeAgentIds(fallbackAgents)
    : [...DEFAULT_SWARM_AGENT_IDS]
}

export function buildDefaultSwarmAgents(
  availableAgents: readonly SupportedAgentId[],
): SwarmAgentConfig[] {
  const candidates = agentsOrFallback(availableAgents)

  return DEFAULT_SWARM_ROLES.map((role, index) => ({
    role,
    agentId: candidates[index % candidates.length],
  }))
}

export function normalizeSwarmAgents(
  agents: readonly SwarmAgentConfig[],
  availableAgents: readonly SupportedAgentId[],
  options: NormalizeSwarmAgentsOptions = {},
): SwarmAgentConfig[] {
  const candidates = dedupeAgentIds(availableAgents)
  if (candidates.length === 0) return agents.map((agent) => ({ ...agent }))

  const usedAgentIds = new Set<SupportedAgentId>()

  return agents.map((agent, index) => {
    const preferredAgentId = candidates.includes(agent.agentId) ? agent.agentId : undefined
    const agentId =
      preferredAgentId && (!options.spreadDuplicates || !usedAgentIds.has(preferredAgentId))
        ? preferredAgentId
        : pickNextAgentId(candidates, usedAgentIds, index)

    usedAgentIds.add(agentId)

    if (agentId === agent.agentId) return { ...agent }

    return {
      ...agent,
      agentId,
      modelOverride: undefined,
    }
  })
}

function agentsOrFallback(
  availableAgents: readonly SupportedAgentId[],
): SupportedAgentId[] {
  const candidates = dedupeAgentIds(availableAgents)
  return candidates.length > 0 ? candidates : [...DEFAULT_SWARM_AGENT_IDS]
}

function pickNextAgentId(
  candidates: readonly SupportedAgentId[],
  usedAgentIds: ReadonlySet<SupportedAgentId>,
  index: number,
): SupportedAgentId {
  return (
    candidates.find((agentId) => !usedAgentIds.has(agentId)) ??
    candidates[index % candidates.length]
  )
}

function dedupeAgentIds(agentIds: readonly SupportedAgentId[]): SupportedAgentId[] {
  return [...new Set(agentIds)]
}
