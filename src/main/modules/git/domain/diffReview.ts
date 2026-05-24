import type { GitChangedFile, GitDiffReviewFinding, GitDiffReviewResult } from '../../../../shared/types'

interface ParsedReview {
  summary?: string
  findings?: unknown[]
}

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low'])

export function normalizeDiffReview(
  responseText: string,
  changedFiles: readonly GitChangedFile[],
): Pick<GitDiffReviewResult, 'summary' | 'findings' | 'rawOutput'> {
  const parsed = parseReview(responseText)
  const knownPaths = new Set(changedFiles.map((file) => file.path))
  const findings = (parsed?.findings ?? [])
    .map((finding, index) => normalizeFinding(finding, knownPaths, index))
    .filter((finding): finding is GitDiffReviewFinding => Boolean(finding))
    .slice(0, 20)

  const normalized: Pick<GitDiffReviewResult, 'summary' | 'findings' | 'rawOutput'> = {
    summary:
      coerceText(parsed?.summary) ??
      (findings.length > 0
        ? `Review found ${findings.length} issue${findings.length === 1 ? '' : 's'}.`
        : 'No concrete issues found in the current diff.'),
    findings,
  }
  const rawOutput = parsed ? undefined : trimRawOutput(responseText)
  return rawOutput ? { ...normalized, rawOutput } : normalized
}

function normalizeFinding(
  value: unknown,
  knownPaths: ReadonlySet<string>,
  index: number,
): GitDiffReviewFinding | null {
  if (!isRecord(value)) return null

  const title = coerceText(value.title) ?? coerceText(value.summary)
  const detail = coerceText(value.detail) ?? coerceText(value.description)
  if (!title || !detail) return null

  const severity = normalizeSeverity(coerceText(value.severity))
  const category = normalizeCategory(coerceText(value.category))
  const filePath = normalizePath(coerceText(value.filePath) ?? coerceText(value.file))
  const line = normalizeLine(value.line)

  return {
    id: `finding-${index + 1}`,
    severity,
    category,
    title,
    detail,
    filePath: filePath && knownPaths.has(filePath) ? filePath : filePath,
    line,
    recommendation:
      coerceText(value.recommendation) ??
      coerceText(value.fix) ??
      coerceText(value.suggestion) ??
      undefined,
  }
}

function parseReview(responseText: string): ParsedReview | null {
  const jsonText = extractJsonBlock(responseText)
  if (!jsonText) return null

  try {
    const parsed = JSON.parse(jsonText) as unknown
    if (!isRecord(parsed)) return null

    return {
      summary: coerceText(parsed.summary),
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    }
  } catch {
    return null
  }
}

function extractJsonBlock(responseText: string): string | null {
  const trimmed = responseText.trim()
  if (!trimmed) return null

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch?.[1]) return fenceMatch[1].trim()

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) return null

  return trimmed.slice(firstBrace, lastBrace + 1)
}

function normalizeSeverity(value: string | undefined): GitDiffReviewFinding['severity'] {
  const normalized = value?.trim().toLowerCase()
  return normalized && SEVERITIES.has(normalized)
    ? (normalized as GitDiffReviewFinding['severity'])
    : 'medium'
}

function normalizeCategory(value: string | undefined): GitDiffReviewFinding['category'] {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'security') return 'security'
  if (normalized === 'missing-test' || normalized === 'test' || normalized === 'testing') {
    return 'missing-test'
  }
  if (normalized === 'regression') return 'regression'
  if (normalized === 'verification') return 'verification'
  return 'bug'
}

function normalizeLine(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value !== 'string') return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function normalizePath(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/^\.?\//, '')
}

function coerceText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function trimRawOutput(responseText: string): string | undefined {
  const trimmed = responseText.trim()
  if (!trimmed) return undefined
  return trimmed.length > 20_000 ? `${trimmed.slice(0, 20_000).trimEnd()}\n[truncated]` : trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
