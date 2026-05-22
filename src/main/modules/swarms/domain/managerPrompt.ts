import type { SupportedAgentId, SwarmAgentConfig } from '../../../../shared/types'

export const MANAGER_AGENT_ROLE = 'manager'

export type ManagerPlanStrategy = 'parallel' | 'sequential'

export interface ManagerPlanAgent extends SwarmAgentConfig {}

export interface ManagerPlan {
  strategy: ManagerPlanStrategy
  agents: ManagerPlanAgent[]
}

export interface ManagerPromptInput {
  supportedAgentIds: readonly SupportedAgentId[]
  maxAgents: number
}

export function buildManagerPrompt({
  supportedAgentIds,
  maxAgents,
}: ManagerPromptInput): string {
  const agentIds = supportedAgentIds.join(', ')

  return [
    'You are the Manager Agent for Lobrecs Agent.',
    'Analyze the user task and produce the execution plan for the worker swarm.',
    '',
    'Constraints:',
    '- Return only a JSON object. Do not wrap it in markdown.',
    '- Do not include commentary outside the JSON object.',
    '- Do not include a manager agent in the plan.',
    '- Choose the smallest useful agent set.',
    `- Use at most ${maxAgents} worker agents.`,
    `- agentId must be one of: ${agentIds}.`,
    '- Prefer "parallel" when the task can be split by file, module, concern, or review angle.',
    '- strategy must be "parallel" when independent work can run together.',
    '- Use "sequential" only when a later agent genuinely needs the exact output from an earlier agent.',
    '- Reviewers, testers, QA, and verification agents must run only after implementers finish.',
    '- Implementers may run in parallel with other implementers, but never in the same phase as reviewers or testers.',
    '- Do not add a planner step before implementation unless the implementation depends on that planner output.',
    '- promptSuffix must be specific enough for that agent to act without guessing.',
    '',
    'JSON schema:',
    '{',
    '  "strategy": "parallel" | "sequential",',
    '  "agents": [',
    '    {',
    '      "role": "planner | implementer | reviewer | tester | security analyzer | ...",',
    '      "agentId": "claude-code | codex | opencode | antigravity",',
    '      "modelOverride": "optional model id",',
    '      "promptSuffix": "role-specific instructions"',
    '    }',
    '  ]',
    '}',
  ].join('\n')
}

export function parseManagerPlan(
  output: string,
  input: ManagerPromptInput,
): ManagerPlan {
  const jsonText = extractJsonDocument(output)
  let parsed: unknown

  try {
    parsed = JSON.parse(jsonText)
  } catch (error) {
    throw new Error('Manager plan must be valid JSON')
  }

  return normalizeManagerPlan(parsed, input)
}

function normalizeManagerPlan(value: unknown, input: ManagerPromptInput): ManagerPlan {
  const record = objectLike(value)
  const strategy = record.strategy

  if (strategy !== 'parallel' && strategy !== 'sequential') {
    throw new Error('Manager plan strategy must be "parallel" or "sequential"')
  }

  if (!Array.isArray(record.agents)) {
    throw new Error('Manager plan agents must be an array')
  }

  if (record.agents.length === 0) {
    throw new Error('Manager plan agents must contain at least one agent')
  }

  if (record.agents.length > input.maxAgents) {
    throw new Error(`Manager plan exceeds the swarm agent limit of ${input.maxAgents}`)
  }

  return {
    strategy,
    agents: record.agents.map((agent, index) =>
      normalizeManagerPlanAgent(agent, index, input.supportedAgentIds),
    ),
  }
}

function normalizeManagerPlanAgent(
  value: unknown,
  index: number,
  supportedAgentIds: readonly SupportedAgentId[],
): ManagerPlanAgent {
  const record = objectLike(value)
  const role = stringValue(record.role).trim()
  const agentId = stringValue(record.agentId).trim()

  if (!role) {
    throw new Error(`Manager plan agent ${index + 1} role is required`)
  }

  if (!supportedAgentIds.includes(agentId as SupportedAgentId)) {
    throw new Error(`Manager plan agent ${index + 1} uses unsupported agentId: ${agentId}`)
  }

  const modelOverride = optionalString(record.modelOverride)
  const promptSuffix = optionalString(record.promptSuffix)

  return {
    role,
    agentId: agentId as SupportedAgentId,
    ...(modelOverride ? { modelOverride } : {}),
    ...(promptSuffix ? { promptSuffix } : {}),
  }
}

function extractJsonDocument(output: string): string {
  const trimmed = output.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]?.trim()) return fenced[1].trim()

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  return trimmed
}

function objectLike(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}
