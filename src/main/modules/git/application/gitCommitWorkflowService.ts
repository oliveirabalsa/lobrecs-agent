import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getModelForTier } from '../../../router/ModelRouter'
import { deriveActivityEvents } from '../../../session/activity'
import type { MainIpcContext } from '../../shared/ipcContext'
import { requireProject } from '../../projects/application/requireProject'
import {
  normalizeSuggestedCommitPlan,
  validateCommitSuggestions,
} from '../domain/commitPlan'
import { normalizeDiffReview } from '../domain/diffReview'
import { pushCurrentBranch } from '../infrastructure/pushCurrentBranch'
import { runGit, runGitOrThrow } from '../infrastructure/runGit'
import type {
  AgentEvent,
  AgentRuntimeSettings,
  GitChangedFile,
  GitCommitAnalysisResult,
  GitCommitPlanExecutionInput,
  GitCommitPlanExecutionResult,
  GitCommitSuggestion,
  GitDiffReviewResult,
  ModelTier,
  SupportedAgentId,
} from '../../../../shared/types'

interface AnalysisAgentSelection {
  agentId: SupportedAgentId
  model: string
  runtimeSettings: AgentRuntimeSettings
}

interface WorkingTreeSnapshot {
  branch: string
  statusSummary: string
  changedFiles: GitChangedFile[]
  fingerprint: string
  prompt: string
  diffStat: string
  trackedPatch: string
  untrackedDiffs: string[]
}

interface AssistantTranscriptState {
  assistantText: string
  streamedText: string
}

const ANALYSIS_TIMEOUT_MS = 45_000
const DIFF_REVIEW_TIMEOUT_MS = 180_000
const MAX_PROMPT_CHARS = 120_000
const MAX_UNTRACKED_FILE_CHARS = 20_000

const ANALYSIS_CANDIDATES: ReadonlyArray<{ agentId: SupportedAgentId; tier: ModelTier }> = [
  { agentId: 'codex', tier: 'lightweight' },
  { agentId: 'antigravity', tier: 'lightweight' },
  { agentId: 'opencode', tier: 'advanced' },
  { agentId: 'opencode', tier: 'balanced' },
  { agentId: 'claude-code', tier: 'lightweight' },
]

export class GitCommitWorkflowService {
  constructor(private readonly context: MainIpcContext) {}

  async analyzeCommitPlan(projectId: string): Promise<GitCommitAnalysisResult> {
    const project = requireProject(projectId)
    const snapshot = await collectWorkingTreeSnapshot(project.repoPath)
    const selection = await selectAnalysisAgent(this.context, projectId)
    const responseText = await runCommitPlannerAgent(
      this.context,
      selection,
      project.repoPath,
      snapshot.prompt,
    )
    const normalized = normalizeSuggestedCommitPlan(responseText, snapshot.changedFiles)

    return {
      projectId,
      fingerprint: snapshot.fingerprint,
      branch: snapshot.branch,
      statusSummary: snapshot.statusSummary,
      analysisSummary: normalized.summary,
      changedFiles: snapshot.changedFiles,
      suggestions: normalized.suggestions,
      analysis: {
        agentId: selection.agentId,
        model: selection.model,
      },
    }
  }

  async executeCommitPlan(
    input: GitCommitPlanExecutionInput,
  ): Promise<GitCommitPlanExecutionResult> {
    const project = requireProject(input.projectId)
    const snapshot = await collectWorkingTreeSnapshot(project.repoPath)
    if (snapshot.fingerprint !== input.fingerprint) {
      throw new Error('The working tree changed. Refresh the commit suggestions and review again.')
    }

    const validationError = validateCommitSuggestions(input.suggestions, snapshot.changedFiles)
    if (validationError) {
      throw new Error(validationError)
    }

    const commits: GitCommitPlanExecutionResult['commits'] = []

    try {
      await runGitOrThrow(['reset', '--quiet', '--', '.'], project.repoPath)

      for (const suggestion of input.suggestions) {
        const stagePaths = expandStagePaths(suggestion.files, snapshot.changedFiles)
        await runGitOrThrow(['add', '--all', '--', ...stagePaths], project.repoPath)
        await runGitOrThrow(['commit', '-m', suggestion.message], project.repoPath)

        const head = await runGitOrThrow(['rev-parse', '--short', 'HEAD'], project.repoPath)
        commits.push({
          hash: head.stdout.trim(),
          message: suggestion.message,
          files: suggestion.files,
        })
      }

      const push = await pushCurrentBranch(project.repoPath, snapshot.branch)
      if (push.exitCode !== 0) {
        throw new Error(
          `${push.stderr.trim() || push.stdout.trim() || 'git push failed'}\n${formatPartialCommitHint(commits)}`,
        )
      }

      return { commits, push }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (commits.length > 0 && !message.includes('Created local commits')) {
        throw new Error(`${message}\n${formatPartialCommitHint(commits)}`)
      }

      throw error
    }
  }

  async reviewCurrentDiff(projectId: string, _threadId?: string): Promise<GitDiffReviewResult> {
    const project = requireProject(projectId)
    const snapshot = await collectWorkingTreeSnapshot(project.repoPath)
    const selection = await selectAnalysisAgent(this.context, projectId)
    const prompt = buildDiffReviewPrompt(snapshot)
    const responseText = await runCommitPlannerAgent(
      this.context,
      selection,
      project.repoPath,
      prompt,
      {
        timeoutMessage: 'Diff review analysis timed out.',
        timeoutMs: DIFF_REVIEW_TIMEOUT_MS,
      },
    )
    const review = normalizeDiffReview(responseText, snapshot.changedFiles)

    return {
      projectId,
      fingerprint: snapshot.fingerprint,
      branch: snapshot.branch,
      statusSummary: snapshot.statusSummary,
      changedFiles: snapshot.changedFiles,
      summary: review.summary,
      findings: review.findings,
      analysis: {
        agentId: selection.agentId,
        model: selection.model,
      },
    }
  }
}

async function collectWorkingTreeSnapshot(repoPath: string): Promise<WorkingTreeSnapshot> {
  await ensureNoMergeConflicts(repoPath)

  const [branchResult, trackedNamesResult, untrackedResult, diffStatResult, patchResult] =
    await Promise.all([
      runGitOrThrow(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath),
      runGitOrThrow(['diff', '--name-status', '--find-renames', '--find-copies', 'HEAD', '--'], repoPath),
      runGitOrThrow(['ls-files', '--others', '--exclude-standard'], repoPath),
      runGitOrThrow(['diff', '--stat=160', 'HEAD', '--'], repoPath),
      runGitOrThrow(['diff', '--find-renames', '--find-copies', 'HEAD', '--'], repoPath),
    ])

  const changedFiles = [
    ...parseTrackedDiffNames(trackedNamesResult.stdout),
    ...parseUntrackedFiles(untrackedResult.stdout),
  ]

  if (changedFiles.length === 0) {
    throw new Error('No local changes to commit.')
  }

  const untrackedDiffs = await Promise.all(
    changedFiles
      .filter((file) => file.status === 'untracked')
      .map((file) => buildUntrackedDiff(repoPath, file.path)),
  )

  const branch = branchResult.stdout.trim() || 'HEAD'
  const prompt = buildCommitAnalysisPrompt({
    branch,
    changedFiles,
    diffStat: diffStatResult.stdout.trim(),
    trackedPatch: patchResult.stdout.trim(),
    untrackedDiffs,
  })

  return {
    branch,
    statusSummary: summarizeWorkingTree(diffStatResult.stdout, changedFiles),
    changedFiles,
    fingerprint: fingerprintWorkingTree(changedFiles, patchResult.stdout, untrackedDiffs),
    prompt,
    diffStat: diffStatResult.stdout.trim(),
    trackedPatch: patchResult.stdout.trim(),
    untrackedDiffs,
  }
}

async function ensureNoMergeConflicts(repoPath: string): Promise<void> {
  const conflicts = await runGitOrThrow(['diff', '--name-only', '--diff-filter=U'], repoPath)
  const files = conflicts.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (files.length > 0) {
    throw new Error(`Resolve merge conflicts before commit & push: ${files.join(', ')}`)
  }
}

function parseTrackedDiffNames(output: string): GitChangedFile[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [statusToken, ...rest] = line.split('\t')
      const code = statusToken.charAt(0)

      if (code === 'R' || code === 'C') {
        const [previousPath = '', nextPath = ''] = rest
        return {
          path: nextPath,
          previousPath,
          status: code === 'R' ? 'renamed' : 'copied',
        } satisfies GitChangedFile
      }

      const [filePath = ''] = rest
      return {
        path: filePath,
        status: mapGitStatus(code),
      } satisfies GitChangedFile
    })
    .filter((file) => file.path)
}

function parseUntrackedFiles(output: string): GitChangedFile[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((filePath) => ({
      path: filePath,
      status: 'untracked',
    }) satisfies GitChangedFile)
}

function mapGitStatus(code: string): GitChangedFile['status'] {
  if (code === 'A') return 'added'
  if (code === 'D') return 'deleted'
  if (code === 'T') return 'type-changed'
  return 'modified'
}

async function buildUntrackedDiff(repoPath: string, relativePath: string): Promise<string> {
  const absolutePath = path.join(repoPath, relativePath)
  const diffResult = await runGit(
    ['diff', '--no-index', '--', '/dev/null', absolutePath],
    repoPath,
  )

  if (diffResult.exitCode === 0 || diffResult.exitCode === 1) {
    return normalizeAbsolutePath(diffResult.stdout.trim(), absolutePath, relativePath)
  }

  const raw = await readFile(absolutePath, 'utf-8')
    .then((text) => text.slice(0, MAX_UNTRACKED_FILE_CHARS))
    .catch(() => '[binary or unreadable file]')

  return [
    `diff --git a/${relativePath} b/${relativePath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${relativePath}`,
    '@@',
    ...raw.split(/\r?\n/).map((line) => `+${line}`),
  ].join('\n')
}

function normalizeAbsolutePath(diffText: string, absolutePath: string, relativePath: string): string {
  return diffText.split(absolutePath).join(relativePath)
}

function summarizeWorkingTree(diffStat: string, changedFiles: readonly GitChangedFile[]): string {
  const shortStat = diffStat
    .trim()
    .split(/\r?\n/)
    .pop()
    ?.trim()

  const untrackedCount = changedFiles.filter((file) => file.status === 'untracked').length
  const fallback = `${changedFiles.length} changed file${changedFiles.length === 1 ? '' : 's'}`
  const withTracked = shortStat || fallback

  return untrackedCount > 0
    ? `${withTracked} • ${untrackedCount} untracked`
    : withTracked
}

function fingerprintWorkingTree(
  changedFiles: readonly GitChangedFile[],
  trackedPatch: string,
  untrackedDiffs: readonly string[],
): string {
  return createHash('sha256')
    .update(JSON.stringify({ changedFiles, trackedPatch, untrackedDiffs }))
    .digest('hex')
}

function buildCommitAnalysisPrompt(input: {
  branch: string
  changedFiles: readonly GitChangedFile[]
  diffStat: string
  trackedPatch: string
  untrackedDiffs: readonly string[]
}): string {
  const changedFilesBlock = input.changedFiles
    .map((file) =>
      file.previousPath
        ? `- ${file.status}: ${file.previousPath} -> ${file.path}`
        : `- ${file.status}: ${file.path}`,
    )
    .join('\n')

  const sections = [
    'You are preparing commit suggestions for a git working tree.',
    '',
    'Rules:',
    '- Return valid JSON only. No markdown fences. No extra prose.',
    '- Use Conventional Commit messages.',
    '- Be direct. Keep summaries short.',
    '- Propose 1 to 4 commits.',
    '- Group by intent, not by file type.',
    '- Every changed file must appear exactly once across commits.',
    '- Never split one file across multiple commits.',
    '- If the changes are tightly related, prefer a single commit.',
    '- Do not mention tests, push, or uncertainty.',
    '',
    'JSON schema:',
    '{',
    '  "summary": "One short sentence.",',
    '  "commits": [',
    '    {',
    '      "message": "feat(scope): short message",',
    '      "summary": "Short reason for this group.",',
    '      "files": ["relative/path.ts"]',
    '    }',
    '  ]',
    '}',
    '',
    `Current branch: ${input.branch}`,
    '',
    'Changed files:',
    changedFilesBlock,
    '',
    'Diff stat:',
    input.diffStat || '(no diff stat available)',
    '',
    'Patch:',
    trimPromptSection(input.trackedPatch || '(tracked patch is empty)'),
  ]

  if (input.untrackedDiffs.length > 0) {
    sections.push('', 'Untracked file diffs:')
    for (const diff of input.untrackedDiffs) {
      sections.push(trimPromptSection(diff))
    }
  }

  return trimPromptSection(sections.join('\n'))
}

function buildDiffReviewPrompt(input: WorkingTreeSnapshot): string {
  const changedFilesBlock = input.changedFiles
    .map((file) =>
      file.previousPath
        ? `- ${file.status}: ${file.previousPath} -> ${file.path}`
        : `- ${file.status}: ${file.path}`,
    )
    .join('\n')

  const sections = [
    'You are reviewing the current git working tree diff.',
    '',
    'Return valid JSON only. No markdown fences. No extra prose.',
    'Focus only on concrete issues introduced by the diff: bugs, regressions, security risks, missing tests, and verification gaps.',
    'Do not praise the code. Do not invent issues. If there are no concrete findings, return an empty findings array.',
    '',
    'JSON schema:',
    '{',
    '  "summary": "One short sentence.",',
    '  "findings": [',
    '    {',
    '      "severity": "critical | high | medium | low",',
    '      "category": "bug | regression | security | missing-test | verification",',
    '      "title": "Short finding title",',
    '      "detail": "Why this is a real issue in this diff.",',
    '      "filePath": "relative/path.ts",',
    '      "line": 123,',
    '      "recommendation": "Concrete fix or verification step."',
    '    }',
    '  ]',
    '}',
    '',
    `Current branch: ${input.branch}`,
    '',
    'Changed files:',
    changedFilesBlock,
    '',
    'Diff stat:',
    input.diffStat || '(no diff stat available)',
    '',
    'Patch:',
    trimPromptSection(input.trackedPatch || '(tracked patch is empty)'),
  ]

  if (input.untrackedDiffs.length > 0) {
    sections.push('', 'Untracked file diffs:')
    for (const diff of input.untrackedDiffs) {
      sections.push(trimPromptSection(diff))
    }
  }

  return trimPromptSection(sections.join('\n'))
}

function trimPromptSection(text: string): string {
  if (text.length <= MAX_PROMPT_CHARS) return text
  return `${text.slice(0, MAX_PROMPT_CHARS).trimEnd()}\n[truncated]`
}

async function selectAnalysisAgent(
  context: MainIpcContext,
  projectId: string,
): Promise<AnalysisAgentSelection> {
  const settings = context.settingsService.getEffective(projectId).settings
  const enabledAgents = settings.agents.enabledAgentIds.filter(
    (agentId) => settings.agents.runtimes[agentId].enabled !== false,
  )

  for (const candidate of ANALYSIS_CANDIDATES) {
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

async function runCommitPlannerAgent(
  context: MainIpcContext,
  selection: AnalysisAgentSelection,
  repoPath: string,
  prompt: string,
  options: { timeoutMessage?: string; timeoutMs?: number } = {},
): Promise<string> {
  const adapter = context.adapters.get(selection.agentId)
  if (!adapter) {
    throw new Error(`Agent adapter is unavailable: ${selection.agentId}`)
  }

  const session = await adapter.dispatch({
    sessionId: `git-commit-plan-${randomUUID()}`,
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
      settleWithError(
        new Error(options.timeoutMessage ?? 'Commit suggestion analysis timed out.'),
      )
    }, options.timeoutMs ?? ANALYSIS_TIMEOUT_MS)

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
        settleWithError(new Error(extractTextFromPayload(event.payload) || 'Analysis failed.'))
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
              'The planner model failed to analyze the diff.',
          ),
        )
        return
      }

      const finalText = transcript.assistantText.trim() || transcript.streamedText.trim()
      if (!finalText) {
        settleWithError(new Error(stderr.at(-1) || 'The planner returned an empty response.'))
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

function expandStagePaths(
  files: readonly string[],
  changedFiles: readonly GitChangedFile[],
): string[] {
  const expanded: string[] = []

  for (const filePath of files) {
    const match = changedFiles.find((file) => file.path === filePath)
    if (!match) continue

    if (match.previousPath) expanded.push(match.previousPath)
    expanded.push(match.path)
  }

  return [...new Set(expanded)]
}

function formatPartialCommitHint(
  commits: readonly GitCommitPlanExecutionResult['commits'][number][],
): string {
  if (commits.length === 0) return 'Created local commits: none.'

  const details = commits.map((commit) => `${commit.hash} ${commit.message}`).join(', ')
  return `Created local commits: ${details}`
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
