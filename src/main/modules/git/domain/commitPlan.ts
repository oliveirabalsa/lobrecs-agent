import type { GitChangedFile, GitCommitSuggestion } from '../../../../shared/types'

interface ParsedCommitPlan {
  summary?: string
  commits?: unknown[]
}

interface ParsedCommitSuggestion {
  message?: string
  summary?: string
  files?: string[]
}

export interface NormalizedCommitPlan {
  summary: string
  suggestions: GitCommitSuggestion[]
}

const CONVENTIONAL_COMMIT_RE =
  /^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]+\))?!?: .+\S$/i

export function normalizeSuggestedCommitPlan(
  responseText: string,
  changedFiles: readonly GitChangedFile[],
): NormalizedCommitPlan {
  const parsed = parseCommitPlan(responseText)
  const suggestions = buildSuggestions(parsed?.commits ?? [], changedFiles)

  return {
    summary:
      coerceText(parsed?.summary) ??
      `Review ${suggestions.length} proposed commit${suggestions.length === 1 ? '' : 's'} before pushing.`,
    suggestions,
  }
}

export function validateCommitSuggestions(
  suggestions: readonly GitCommitSuggestion[],
  changedFiles: readonly GitChangedFile[],
): string | null {
  if (suggestions.length === 0) {
    return 'Add at least one commit before pushing.'
  }

  const knownPaths = new Set(changedFiles.map((file) => file.path))
  const assigned = new Set<string>()

  for (const suggestion of suggestions) {
    if (!suggestion.message.trim()) {
      return 'Each suggested commit needs a message.'
    }

    if (!CONVENTIONAL_COMMIT_RE.test(suggestion.message.trim())) {
      return `Commit message must use Conventional Commits: ${suggestion.message}`
    }

    if (suggestion.files.length === 0) {
      return `Commit "${suggestion.message}" has no files.`
    }

    for (const file of suggestion.files) {
      if (!knownPaths.has(file)) {
        return `Commit "${suggestion.message}" references an unknown file: ${file}`
      }

      if (assigned.has(file)) {
        return `Each file can belong to only one commit: ${file}`
      }

      assigned.add(file)
    }
  }

  const missing = changedFiles
    .map((file) => file.path)
    .filter((filePath) => !assigned.has(filePath))

  if (missing.length > 0) {
    return `Assign every changed file before pushing. Missing: ${missing.join(', ')}`
  }

  return null
}

function buildSuggestions(
  rawCommits: readonly unknown[],
  changedFiles: readonly GitChangedFile[],
): GitCommitSuggestion[] {
  const aliases = createFileAliasMap(changedFiles)
  const usedPaths = new Set<string>()
  const suggestions: GitCommitSuggestion[] = []

  for (const rawCommit of rawCommits.slice(0, 6)) {
    const commit = normalizeRawCommit(rawCommit)
    if (!commit) continue

    const files = commit.files
      ?.map((file) => aliases.get(normalizePath(file)))
      .filter((filePath): filePath is string => Boolean(filePath))
      .filter((filePath) => {
        if (usedPaths.has(filePath)) return false
        usedPaths.add(filePath)
        return true
      })

    if (!files || files.length === 0) continue

    suggestions.push({
      id: `commit-${suggestions.length + 1}`,
      message: normalizeCommitMessage(commit.message),
      summary: coerceText(commit.summary) ?? 'Grouped by intent from the current diff.',
      files,
    })
  }

  const remainingFiles = changedFiles
    .map((file) => file.path)
    .filter((filePath) => !usedPaths.has(filePath))

  if (remainingFiles.length > 0 || suggestions.length === 0) {
    suggestions.push({
      id: `commit-${suggestions.length + 1}`,
      message: 'chore(changes): capture remaining edits',
      summary: 'Any files that were not confidently assigned by the planner.',
      files: remainingFiles.length > 0 ? remainingFiles : changedFiles.map((file) => file.path),
    })
  }

  return suggestions
}

function normalizeRawCommit(value: unknown): ParsedCommitSuggestion | null {
  if (!isRecord(value)) return null

  const files = Array.isArray(value.files)
    ? value.files
        .map((file) => {
          if (typeof file === 'string') return file
          if (isRecord(file) && typeof file.path === 'string') return file.path
          return null
        })
        .filter((file): file is string => Boolean(file))
    : undefined

  return {
    message:
      coerceText(value.message) ??
      coerceText(value.commitMessage) ??
      coerceText(value.title) ??
      undefined,
    summary:
      coerceText(value.summary) ??
      coerceText(value.description) ??
      coerceText(value.rationale) ??
      coerceText(value.why) ??
      undefined,
    files,
  }
}

function parseCommitPlan(responseText: string): ParsedCommitPlan | null {
  const jsonText = extractJsonBlock(responseText)
  if (!jsonText) return null

  try {
    const parsed = JSON.parse(jsonText) as unknown
    if (!isRecord(parsed)) return null

    return {
      summary: coerceText(parsed.summary),
      commits: Array.isArray(parsed.commits) ? parsed.commits : [],
    }
  } catch {
    return null
  }
}

function extractJsonBlock(responseText: string): string | null {
  const trimmed = responseText.trim()
  if (!trimmed) return null

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim()
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    return null
  }

  return trimmed.slice(firstBrace, lastBrace + 1)
}

function createFileAliasMap(
  changedFiles: readonly GitChangedFile[],
): Map<string, string> {
  const aliases = new Map<string, string>()

  for (const file of changedFiles) {
    aliases.set(normalizePath(file.path), file.path)
    if (file.previousPath) {
      aliases.set(normalizePath(file.previousPath), file.path)
    }
  }

  return aliases
}

function normalizeCommitMessage(message: string | undefined): string {
  const trimmed = message?.trim()
  if (!trimmed) return 'chore(changes): capture pending edits'
  if (CONVENTIONAL_COMMIT_RE.test(trimmed)) return trimmed

  const headline = trimmed
    .replace(/[`"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return headline ? `chore(changes): ${headline}` : 'chore(changes): capture pending edits'
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').trim()
}

function coerceText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
