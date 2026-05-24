import type {
  AgentActivity,
  UserQuestionPromptOption,
  UserQuestionPromptQuestion,
} from './sessions'

type UserQuestionActivity = Extract<AgentActivity, { kind: 'user-question' }>

const TOOL_NAMES = new Set([
  'askuserquestion',
  'askquestion',
  'askuser',
  'askhuman',
  'clarify',
  'clarification',
  'clarifyingquestion',
  'requestclarification',
  'requesthumaninput',
  'requestinput',
  'requestuserinput',
])
const MAX_QUESTIONS = 8
const MAX_OPTIONS_PER_QUESTION = 16
const MAX_QUESTION_CHARS = 2_000
const MAX_OPTION_LABEL_CHARS = 160
const MAX_OPTION_DESCRIPTION_CHARS = 360
const MAX_HEADER_CHARS = 80

export function isUserQuestionToolName(name: unknown): boolean {
  const normalized = cleanString(name)?.toLowerCase()
  if (!normalized) return false

  const canonical = canonicalToolName(normalized)
  if (isUserQuestionCanonicalName(canonical)) return true

  const parts = normalized.split(/[.:/]/)
  const tail = parts[parts.length - 1]
  return tail ? isUserQuestionCanonicalName(canonicalToolName(tail)) : false
}

export function shouldSuppressUserQuestionToolResult(
  toolName: unknown,
  output: unknown,
): boolean {
  if (isUserQuestionToolName(toolName)) return true

  const text = cleanString(output)
  return text === 'Answer questions?'
}

export function userQuestionActivityFromToolPayload(
  payload: unknown,
): UserQuestionActivity | null {
  if (!isRecord(payload)) return null
  if (!isUserQuestionToolName(toolNameFromPayload(payload))) return null

  const input = inputFromPayload(payload)
  const rawQuestions = rawQuestionsFromInput(input)
  const questionIds = new Set<string>()
  const questions = rawQuestions
    .slice(0, MAX_QUESTIONS)
    .map((question, index) => normalizeQuestion(question, index, questionIds))
    .filter((question): question is UserQuestionPromptQuestion => question !== null)

  if (questions.length === 0) return null

  const title =
    questions.length === 1
      ? questions[0].header ?? 'Agent question'
      : 'Agent questions'

  return {
    kind: 'user-question',
    promptId: promptIdFromPayload(payload, questions),
    title,
    questions,
  }
}

function rawQuestionsFromInput(input: Record<string, unknown>): unknown[] {
  if (Array.isArray(input.questions)) return input.questions

  if (cleanString(input.question) || cleanString(input.text)) {
    return [input]
  }

  return []
}

function normalizeQuestion(
  value: unknown,
  index: number,
  usedIds: Set<string>,
): UserQuestionPromptQuestion | null {
  if (!isRecord(value)) return null

  const question = limitedString(
    cleanString(value.question) ?? cleanString(value.text),
    MAX_QUESTION_CHARS,
  )
  if (!question) return null

  const optionIds = new Set<string>()
  const rawOptions = Array.isArray(value.options) ? value.options : []
  const options = rawOptions
    .slice(0, MAX_OPTIONS_PER_QUESTION)
    .map((option, optionIndex) => normalizeOption(option, index, optionIndex, optionIds))
    .filter((option): option is UserQuestionPromptOption => option !== null)

  return {
    id: uniqueId(cleanString(value.id), `question-${index + 1}`, usedIds),
    header: limitedString(cleanString(value.header), MAX_HEADER_CHARS),
    question,
    multiSelect: value.multiSelect === true || value.multi_select === true,
    options,
  }
}

function normalizeOption(
  value: unknown,
  questionIndex: number,
  optionIndex: number,
  usedIds: Set<string>,
): UserQuestionPromptOption | null {
  const record = isRecord(value) ? value : null
  const label = limitedString(
    typeof value === 'string'
      ? cleanString(value)
      : cleanString(record?.label) ?? cleanString(record?.value) ?? cleanString(record?.title),
    MAX_OPTION_LABEL_CHARS,
  )
  if (!label) return null

  return {
    id: uniqueId(
      cleanString(record?.id),
      `question-${questionIndex + 1}-option-${optionIndex + 1}`,
      usedIds,
    ),
    label,
    description: limitedString(
      cleanString(record?.description) ?? cleanString(record?.detail),
      MAX_OPTION_DESCRIPTION_CHARS,
    ),
  }
}

function inputFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const nestedFunction = isRecord(payload.function) ? payload.function : undefined
  const nestedState = isRecord(payload.state) ? payload.state : undefined
  const candidates = [
    payload.arguments,
    payload.args,
    payload.input,
    payload.params,
    payload.parameters,
    nestedFunction?.arguments,
    nestedFunction?.input,
    nestedFunction?.parameters,
    nestedState?.input,
  ]

  for (const candidate of candidates) {
    const parsed = structuredInput(candidate)
    if (parsed) return parsed
  }

  return payload
}

function structuredInput(input: unknown): Record<string, unknown> | null {
  if (isRecord(input)) return input
  if (typeof input !== 'string') return null

  try {
    const parsed = JSON.parse(input) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function toolNameFromPayload(payload: Record<string, unknown>): unknown {
  if (payload.name) return payload.name
  if (payload.tool) return payload.tool
  if (payload.tool_name) return payload.tool_name
  if (payload.toolName) return payload.toolName
  if (payload.functionName) return payload.functionName
  if (payload.function_name) return payload.function_name
  if (isUserQuestionToolName(payload.type)) return payload.type

  const nestedFunction = isRecord(payload.function) ? payload.function : undefined
  return nestedFunction?.name
}

function isUserQuestionCanonicalName(name: string): boolean {
  if (TOOL_NAMES.has(name)) return true
  return [...TOOL_NAMES].some((toolName) => name.endsWith(toolName))
}

function canonicalToolName(name: string): string {
  return name.replace(/[^a-z0-9]/g, '')
}

function promptIdFromPayload(
  payload: Record<string, unknown>,
  questions: readonly UserQuestionPromptQuestion[],
): string {
  const directId =
    cleanString(payload.call_id) ??
    cleanString(payload.callId) ??
    cleanString(payload.tool_call_id) ??
    cleanString(payload.toolCallId) ??
    cleanString(payload.id)
  if (directId) return `user-question:${directId}`

  return `user-question:${hashString(JSON.stringify(questions))}`
}

function uniqueId(rawId: string | undefined, fallback: string, usedIds: Set<string>): string {
  const base = rawId || fallback
  let id = base
  let suffix = 2

  while (usedIds.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }

  usedIds.add(id)
  return id
}

function limitedString(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function hashString(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
