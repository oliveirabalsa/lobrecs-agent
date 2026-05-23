import { randomUUID } from 'node:crypto'
import { getModelForTier } from '../../../router/ModelRouter'
import { deriveActivityEvents } from '../../../session/activity'
import type { MainIpcContext } from '../../shared/ipcContext'
import { requireProject } from '../../projects/application/requireProject'
import type {
  AgentEvent,
  AgentRuntimeSettings,
  ModelTier,
  SupportedAgentId,
} from '../../../../shared/types'

interface SuggestionAgentSelection {
  agentId: SupportedAgentId
  model: string
  runtimeSettings: AgentRuntimeSettings
}

interface AssistantTranscriptState {
  assistantText: string
  streamedText: string
}

export interface SpecDraftSuggestion {
  constraints: string
  requirements: string[]
  acceptanceCriteria: string[]
  targetFiles: string[]
}

const SUGGESTION_TIMEOUT_MS = 45_000
const MAX_PROMPT_CHARS = 120_000

const SUGGESTION_CANDIDATES: ReadonlyArray<{ agentId: SupportedAgentId; tier: ModelTier }> = [
  { agentId: 'codex', tier: 'lightweight' },
  { agentId: 'antigravity', tier: 'lightweight' },
  { agentId: 'opencode', tier: 'advanced' },
  { agentId: 'opencode', tier: 'balanced' },
  { agentId: 'claude-code', tier: 'lightweight' },
]

export async function suggestSpecDraft(
  context: MainIpcContext,
  projectId: string,
  title: string,
  goal: string,
): Promise<SpecDraftSuggestion> {
  const project = requireProject(projectId)

  // 1. Search the repository context for relevant code snippets using the title/goal as a query
  let snippets: Array<{ path: string; startLine: number; endLine: number; content: string }> = []
  try {
    const searchResult = await context.repositoryContext.search({
      projectId: project.id,
      repoPath: project.repoPath,
      query: `${title} ${goal}`,
      limit: 15,
    })
    snippets = searchResult
  } catch (error) {
    console.error('Failed to retrieve repository context for spec suggestion:', error)
  }

  // 2. Select an agent to run the suggestion task
  const selection = await selectSuggestionAgent(context, projectId)

  // 3. Build the prompt
  const prompt = buildSuggestionPrompt(title, goal, snippets)

  // 4. Dispatch the suggestion agent
  const responseText = await runSuggestionAgent(context, selection, project.repoPath, prompt)

  // 5. Parse and return the JSON suggestion
  return parseSuggestionResponse(responseText)
}

function buildSuggestionPrompt(
  title: string,
  goal: string,
  snippets: Array<{ path: string; startLine: number; endLine: number; content: string }>,
): string {
  const sections = [
    'You are an expert software architect and developer.',
    'Your task is to analyze a proposed spec goal and suggest architectural constraints, requirements, acceptance criteria, and target files.',
    '',
    'Rules:',
    '- Return valid JSON only. Do NOT wrap it in markdown block fences. Do NOT add extra explanations or markdown prose outside the JSON.',
    '- Follow the JSON schema specified below.',
    '- Identify the files in the codebase that are most relevant to the proposed goal and include their relative paths in the "targetFiles" array.',
    '- Identify architectural constraints based on the codebase context (e.g., frameworks, dependencies, design patterns) and write them as a single cohesive string in "constraints".',
    '- Propose concrete, testable requirements in the "requirements" array.',
    '- Propose precise, verification-ready acceptance criteria in the "acceptanceCriteria" array.',
    '',
    'JSON Schema:',
    '{',
    '  "constraints": "string detailing constraints",',
    '  "requirements": ["requirement 1", "requirement 2"],',
    '  "acceptanceCriteria": ["criterion 1", "criterion 2"],',
    '  "targetFiles": ["src/relative/path/to/file.ts"]',
    '}',
    '',
    `Proposed Spec Title: ${title}`,
    `Proposed Spec Goal: ${goal}`,
    '',
  ]

  if (snippets.length > 0) {
    sections.push('Relevant codebase snippets to help identify target files and constraints:')
    for (const snippet of snippets) {
      sections.push(`--- File: ${snippet.path} (Lines ${snippet.startLine}-${snippet.endLine}) ---`)
      sections.push(snippet.content)
      sections.push('')
    }
  }

  return trimPrompt(sections.join('\n'))
}

function trimPrompt(text: string): string {
  if (text.length <= MAX_PROMPT_CHARS) return text
  return `${text.slice(0, MAX_PROMPT_CHARS).trimEnd()}\n[truncated]`
}

async function selectSuggestionAgent(
  context: MainIpcContext,
  projectId: string,
): Promise<SuggestionAgentSelection> {
  const settings = context.settingsService.getEffective(projectId).settings
  const enabledAgents = settings.agents.enabledAgentIds.filter(
    (agentId) => settings.agents.runtimes[agentId].enabled !== false,
  )

  for (const candidate of SUGGESTION_CANDIDATES) {
    if (!enabledAgents.includes(candidate.agentId)) continue
    const adapter = context.adapters.get(candidate.agentId)
    if (!adapter) continue

    try {
      if (!(await adapter.isInstalled())) continue
    } catch {
      continue
    }

    return {
      agentId: candidate.agentId,
      model: getModelForTier(candidate.agentId, candidate.tier, settings),
      runtimeSettings: {
        ...context.settingsService.getAgentRuntime(candidate.agentId, projectId),
        permissionMode: 'read-only',
      },
    }
  }

  for (const agentId of enabledAgents) {
    const adapter = context.adapters.get(agentId)
    if (!adapter) continue

    try {
      if (!(await adapter.isInstalled())) continue
    } catch {
      continue
    }

    return {
      agentId,
      model: getModelForTier(agentId, 'lightweight', settings),
      runtimeSettings: {
        ...context.settingsService.getAgentRuntime(agentId, projectId),
        permissionMode: 'read-only',
      },
    }
  }

  throw new Error('No lightweight analysis model is available. Enable Codex, Antigravity, or OpenCode first.')
}

async function runSuggestionAgent(
  context: MainIpcContext,
  selection: SuggestionAgentSelection,
  repoPath: string,
  prompt: string,
): Promise<string> {
  const adapter = context.adapters.get(selection.agentId)
  if (!adapter) {
    throw new Error(`Agent adapter is unavailable: ${selection.agentId}`)
  }

  const session = await adapter.dispatch({
    sessionId: `spec-suggest-${randomUUID()}`,
    prompt,
    repoPath,
    model: selection.model,
    runtimeSettings: selection.runtimeSettings,
  })

  return new Promise((resolve, reject) => {
    const transcript: AssistantTranscriptState = {
      assistantText: '',
      streamedText: '',
    }
    const stderr: string[] = []
    let settled = false

    const timeout = setTimeout(() => {
      session.cancel()
      settleWithError(new Error('Spec suggestion analysis timed out.'))
    }, SUGGESTION_TIMEOUT_MS)

    const settleWithError = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    }

    const settleWithSuccess = (text: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(text)
    }

    session.events.on('event', (event: AgentEvent) => {
      if (event.type === 'stderr') {
        const text = extractTextFromPayload(event.payload)
        if (text.trim()) stderr.push(text.trim())
        return
      }

      if (event.type === 'error') {
        settleWithError(new Error(extractTextFromPayload(event.payload) || 'Suggestion failed.'))
        return
      }

      for (const activityEvent of deriveActivityEvents(event)) {
        const payload = activityEvent.payload
        if (!isAssistantActivityMessage(payload)) continue

        if (payload.stream) {
          transcript.streamedText += payload.text
        } else {
          transcript.assistantText = payload.text
        }
      }

      if (event.type !== 'session-complete') return

      if (completionFailed(event.payload)) {
        settleWithError(
          new Error(
            extractTextFromPayload(event.payload) ||
              stderr.at(-1) ||
              'The spec suggestion agent failed to complete.',
          ),
        )
        return
      }

      const finalText = transcript.assistantText.trim() || transcript.streamedText.trim()
      if (!finalText) {
        settleWithError(new Error(stderr.at(-1) || 'The suggestion agent returned an empty response.'))
        return
      }

      settleWithSuccess(finalText)
    })
  })
}

function extractTextFromPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (!isRecord(payload)) return ''

  if (typeof payload.text === 'string') return payload.text

  for (const field of ['message', 'content', 'delta', 'output', 'result', 'summary', 'error', 'item']) {
    const value = payload[field]
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
      const nested = value.map((item) => extractTextFromPayload(item)).join('')
      if (nested) return nested
    }
    if (isRecord(value)) {
      const nested = extractTextFromPayload(value)
      if (nested) return nested
    }
  }

  return ''
}

function completionFailed(payload: unknown): boolean {
  if (!isRecord(payload)) return false
  if (payload.subtype === 'error' || payload.is_error === true) return true
  if (payload.status === 'error' || payload.status === 'cancelled') return true

  const exitCode = payload.exitCode ?? payload.exit_code
  return typeof exitCode === 'number' && exitCode !== 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAssistantActivityMessage(
  payload: unknown,
): payload is { kind: 'message'; role: 'assistant'; text: string; stream?: boolean } {
  return (
    isRecord(payload) &&
    payload.kind === 'message' &&
    payload.role === 'assistant' &&
    typeof payload.text === 'string'
  )
}

export function parseSuggestionResponse(text: string): SpecDraftSuggestion {
  // Strip any markdown fence formatting if LLM disobeyed instructions
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '')
  }
  cleaned = cleaned.trim()

  try {
    const parsed = JSON.parse(cleaned)
    return {
      constraints: typeof parsed.constraints === 'string' ? parsed.constraints : '',
      requirements: Array.isArray(parsed.requirements) ? parsed.requirements.map(String) : [],
      acceptanceCriteria: Array.isArray(parsed.acceptanceCriteria) ? parsed.acceptanceCriteria.map(String) : [],
      targetFiles: Array.isArray(parsed.targetFiles) ? parsed.targetFiles.map(String) : [],
    }
  } catch (error) {
    console.error('Failed to parse spec suggestion JSON response:', text)
    throw new Error('Failed to parse suggestion response as valid JSON.')
  }
}
