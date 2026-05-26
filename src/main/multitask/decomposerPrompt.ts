export interface RawDecomposedTask {
  title: string
  description: string
  complexity: 'low' | 'medium' | 'high' | 'critical'
  dependsOn?: string[]
}

const VALID_COMPLEXITIES = new Set(['low', 'medium', 'high', 'critical'])

export function buildDecomposerPrompt(maxTasks?: number): string {
  const normalizedMaxTasks = normalizeMaxTasks(maxTasks)
  return [
    'You are a task decomposer for a multi-agent coding system.',
    'Given a user prompt, break it into independent subtasks that can each be completed by a single coding agent.',
    '',
    'Rules:',
    '- Return only a JSON array. Do not wrap it in markdown fences or add commentary.',
    '- Each element must have: "title", "description", "complexity", and optionally "dependsOn".',
    '- "title" is a short, unique label for the subtask (2-6 words).',
    '- "description" is a clear, self-contained instruction an agent can act on without additional context.',
    '- "complexity" must be one of: "low", "medium", "high", "critical".',
    '  - low: simple, mechanical changes (rename, add a field, fix a typo, small config change).',
    '  - medium: moderate logic (new function, test file, refactor a module, add validation).',
    '  - high: significant design work (new feature across files, architectural change, complex integration).',
    '  - critical: frontier-level reasoning (security audit, performance architecture, cross-system migration).',
    '- "dependsOn" is an array of other task titles that must complete before this task can start.',
    '- Identify truly independent work that can run in parallel — only add dependencies when a task genuinely needs the output of another.',
    '- Keep subtasks focused: each should be completable by a single agent in one session.',
    '- Do NOT create subtasks for trivial implicit steps like "read the codebase", "understand the project", or "set up the environment".',
    '- Do NOT create a subtask for "review" or "verify" unless the user explicitly asked for it.',
    '- If the prompt describes a single atomic change, return an array with one task.',
    '- Aim for the minimal set of subtasks that fully covers the user request.',
    ...(normalizedMaxTasks
      ? [
          `- Return at most ${normalizedMaxTasks} subtasks because this project allows at most ${normalizedMaxTasks} swarm agents. If there is more work, consolidate related work into those ${normalizedMaxTasks} subtasks instead of adding more agents.`,
        ]
      : []),
    '',
    'JSON schema for each element:',
    '{',
    '  "title": "string",',
    '  "description": "string",',
    '  "complexity": "low" | "medium" | "high" | "critical",',
    '  "dependsOn": ["title of prerequisite task"]',
    '}',
  ].join('\n')
}

export function parseDecomposerOutput(output: string): RawDecomposedTask[] {
  const jsonText = extractJsonArray(output)
  let parsed: unknown

  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('Decomposer output must be valid JSON')
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Decomposer output must be a JSON array')
  }

  if (parsed.length === 0) {
    throw new Error('Decomposer output must contain at least one task')
  }

  return parsed.map((item, index) => normalizeRawTask(item, index))
}

function normalizeRawTask(value: unknown, index: number): RawDecomposedTask {
  const record = objectLike(value)
  const title = stringValue(record.title).trim()
  const description = stringValue(record.description).trim()
  const complexity = stringValue(record.complexity).trim().toLowerCase()

  if (!title) {
    throw new Error(`Decomposed task ${index + 1} is missing a title`)
  }

  if (!description) {
    throw new Error(`Decomposed task ${index + 1} is missing a description`)
  }

  if (!VALID_COMPLEXITIES.has(complexity)) {
    throw new Error(
      `Decomposed task ${index + 1} has invalid complexity "${complexity}"; expected low, medium, high, or critical`,
    )
  }

  const dependsOn = normalizeDependsOn(record.dependsOn)

  return {
    title,
    description,
    complexity: complexity as RawDecomposedTask['complexity'],
    ...(dependsOn.length > 0 ? { dependsOn } : {}),
  }
}

function normalizeDependsOn(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function extractJsonArray(output: string): string {
  const trimmed = output.trim()

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]?.trim()) return fenced[1].trim()

  const firstBracket = trimmed.indexOf('[')
  const lastBracket = trimmed.lastIndexOf(']')
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1)
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

function normalizeMaxTasks(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : undefined
}
