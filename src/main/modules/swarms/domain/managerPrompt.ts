import type { SupportedAgentId, SwarmAgentConfig } from '../../../../shared/types'

export const MANAGER_AGENT_ROLE = 'manager'

export type ManagerPlanStrategy = 'parallel' | 'sequential'
export type ManagerPlanStatus = 'continue' | 'complete'

export interface ManagerPlanAgent extends SwarmAgentConfig {}

export interface ManagerPlan {
  status: ManagerPlanStatus
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
    'Analyze the user task and produce the next execution phase for the worker swarm.',
    '',
    'Constraints:',
    '- Return only a JSON object. Do not wrap it in markdown.',
    '- Do not include commentary outside the JSON object.',
    '- Do not include a manager agent in the plan.',
    '- Return only the next useful phase, not the entire swarm lifecycle.',
    '- You will be called again after the selected phase finishes with the completed output.',
    '- Choose the smallest useful agent set for this phase.',
    `- Use at most ${maxAgents} worker agents in this phase.`,
    `- agentId must be one of: ${agentIds}.`,
    '- Use status "complete" with an empty agents array when no more worker, reviewer, tester, or QA agents are needed.',
    '- If the task needs a concrete plan before implementation, make the first phase a single planner agent.',
    '- Do not decide implementer count until planner output is available.',
    '- After implementers finish, decide whether the next phase needs review, tests, QA, or completion based on the latest output.',
    '- Model policy: MiniMax via opencode is cheap and should be used often for simple or routine worker tasks.',
    '- Model policy: for complex, risky, or high-intelligence work, prefer codex first, then claude-code Opus.',
    '- Model policy: do not choose claude-code by default; use it only when Codex is unavailable or the role clearly needs Opus-level reasoning.',
    '- Model policy: for frontier choices, rank codex GPT-5.5 and Claude Opus as top intelligence, Gemini 3.5 Flash next, MiniMax M2.7 after that.',
    '- Prefer "parallel" when the task can be split by file, module, concern, or review angle.',
    '- strategy must be "parallel" when independent work can run together.',
    '- Use "sequential" only when a later agent genuinely needs the exact output from an earlier agent.',
    '- Reviewers, testers, QA, and verification agents must run only in a phase after implementers finish.',
    '- Implementers may run in parallel with other implementers, but never in the same phase as reviewers, testers, or QA.',
    '- promptSuffix must be specific enough for that agent to act without guessing.',
    '- requireApprovalAfter is optional and only meaningful in sequential plans.',
    '- Set requireApprovalAfter: true on a planner step ONLY when the next step is an implementer — this lets the user review the plan before implementation begins.',
    '- Do not set requireApprovalAfter on any other transition.',
    '',
    'JSON schema:',
    '{',
    '  "status": "continue" | "complete",',
    '  "strategy": "parallel" | "sequential",',
    '  "agents": [',
    '    {',
    '      "role": "planner | implementer | reviewer | tester | security analyzer | ...",',
    '      "agentId": "claude-code | codex | opencode | antigravity",',
    '      "modelOverride": "optional model id",',
    '      "promptSuffix": "role-specific instructions",',
    '      "requireApprovalAfter": false',
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
  const status = record.status === 'complete' ? 'complete' : 'continue'
  const strategy = record.strategy

  if (status === 'complete') {
    return {
      status,
      strategy: strategy === 'parallel' || strategy === 'sequential' ? strategy : 'sequential',
      agents: [],
    }
  }

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

  const agents = record.agents.map((agent, index) =>
    normalizeManagerPlanAgent(agent, index, input.supportedAgentIds),
  )

  return {
    status,
    strategy,
    agents: agents.map((agent, index) =>
      gateApprovalFlag(agent, agents[index + 1], strategy),
    ),
  }
}

function gateApprovalFlag(
  current: ManagerPlanAgent,
  next: ManagerPlanAgent | undefined,
  strategy: ManagerPlanStrategy,
): ManagerPlanAgent {
  if (!current.requireApprovalAfter) return current

  const allowed =
    strategy === 'sequential' &&
    isPlannerRole(current.role) &&
    next !== undefined &&
    isImplementerRole(next.role)

  if (allowed) return current

  const { requireApprovalAfter: _, ...rest } = current
  return rest
}

function isPlannerRole(role: string): boolean {
  return /\bplan(ner|ning)?\b/i.test(role)
}

function isImplementerRole(role: string): boolean {
  return /(implement|build|coder?|develop|writ|refactor)/i.test(role)
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
  const requireApprovalAfter = record.requireApprovalAfter === true

  return {
    role,
    agentId: agentId as SupportedAgentId,
    ...(modelOverride ? { modelOverride } : {}),
    ...(promptSuffix ? { promptSuffix } : {}),
    ...(requireApprovalAfter ? { requireApprovalAfter: true } : {}),
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
