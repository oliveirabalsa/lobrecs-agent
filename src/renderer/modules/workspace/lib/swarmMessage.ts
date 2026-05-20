import { AGENT_LABELS, type SupportedAgentId } from '../../../../shared/types'

/**
 * Swarm message detection.
 *
 * Two kinds of swarm traffic land in the normal chat stream as raw text:
 *
 *  1. The managed-swarm manager agent emits its execution plan as a JSON
 *     object (see `main/modules/swarms/domain/managerPrompt.ts`). Without
 *     special handling that JSON renders as an unreadable blob.
 *  2. Every worker session is dispatched with a prompt prefixed by a
 *     `[Role: <role>]` header (see `SwarmOrchestrator.buildAgentPrompt`). That
 *     header is plumbing, not something the user typed.
 *
 * These helpers recognize both shapes so the renderer can swap in a formatted
 * component. They are intentionally strict: anything that isn't an obvious
 * swarm artifact returns `null`, and the caller falls back to plain markdown.
 */

export interface SwarmPlanAgentView {
  role: string
  /** Raw agent id from the plan (e.g. `claude-code`). */
  agentId: string
  /** Human label resolved from `AGENT_LABELS`, falling back to the raw id. */
  agentLabel: string
  modelOverride?: string
  promptSuffix?: string
}

export interface SwarmPlanView {
  strategy: 'parallel' | 'sequential'
  agents: SwarmPlanAgentView[]
}

export interface SwarmRolePromptView {
  /** Role name lifted out of the `[Role: ...]` header. */
  role: string
  /** Everything after the header — the actual task + handoff context. */
  body: string
}

/** Coarse role classification used to give swarm roles a consistent accent. */
export type SwarmRoleKind = 'planner' | 'builder' | 'reviewer' | 'security' | 'generic'

/**
 * Detects the JSON execution plan emitted by the managed-swarm manager agent.
 * Returns `null` for anything that is not a recognizable plan so the caller
 * can fall back to normal markdown rendering.
 */
export function parseSwarmPlan(text: string): SwarmPlanView | null {
  const candidate = extractJsonObject(text)
  if (!candidate) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null
  const strategy = parsed.strategy
  if (strategy !== 'parallel' && strategy !== 'sequential') return null
  if (!Array.isArray(parsed.agents) || parsed.agents.length === 0) return null

  const agents: SwarmPlanAgentView[] = []
  for (const entry of parsed.agents) {
    if (!isRecord(entry)) return null
    const role = textValue(entry.role)
    const agentId = textValue(entry.agentId)
    // A real plan always names a role and an agent for every step. A missing
    // field means this JSON is something else — bail out entirely.
    if (!role || !agentId) return null
    agents.push({
      role,
      agentId,
      agentLabel: AGENT_LABELS[agentId as SupportedAgentId] ?? agentId,
      modelOverride: optionalText(entry.modelOverride),
      promptSuffix: optionalText(entry.promptSuffix),
    })
  }

  return { strategy, agents }
}

/**
 * Detects the `[Role: <role>]` header that `SwarmOrchestrator` prepends to
 * every worker prompt and splits it into the role + the remaining body.
 */
export function parseSwarmRolePrompt(text: string): SwarmRolePromptView | null {
  const match = text.match(/^\s*\[Role:\s*([^\]\n]+)\]\s*\n?/i)
  const role = match?.[1]?.trim()
  if (!match || !role) return null

  return { role, body: text.slice(match[0].length).trim() }
}

/**
 * Classifies an arbitrary swarm role string into a small set of kinds so the
 * UI can assign a stable accent colour. Worker roles are free-form (the
 * manager agent invents them), so this matches on keywords rather than an
 * exact list.
 */
export function swarmRoleKind(role: string): SwarmRoleKind {
  const normalized = role.toLowerCase()
  if (/(secur|threat|vuln|exploit)/.test(normalized)) return 'security'
  if (/(review|audit|\bqa\b|test|verif|critic)/.test(normalized)) return 'reviewer'
  if (/(implement|build|code|develop|\bfix\b|write|refactor)/.test(normalized)) return 'builder'
  if (/(plan|architect|design|scope|research|analy)/.test(normalized)) return 'planner'
  return 'generic'
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // The manager is told to return bare JSON, but tolerate a ```json fence.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const source = fenced?.[1]?.trim() ?? trimmed

  const first = source.indexOf('{')
  const last = source.lastIndexOf('}')
  if (first === -1 || last <= first) return null
  return source.slice(first, last + 1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown): string | undefined {
  const text = textValue(value)
  return text ? text : undefined
}
