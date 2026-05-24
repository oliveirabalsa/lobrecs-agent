import type Database from 'better-sqlite3'
import { execFile, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { AgentAdapter } from '../../../agents'
import { resolveCommand, runCommandText } from '../../../agents/command'
import { buildProcessEnvironment } from '../../../process/environment'
import {
  AGENT_LABELS,
  SUPPORTED_AGENT_IDS,
  type AgentRuntimeSettings,
  type ProviderUsageRow,
  type ProviderUsageSummary,
  type SupportedAgentId,
} from '../../../../shared/types'

const execFileAsync = promisify(execFile)
const ANTHROPIC_OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const ANTIGRAVITY_QUOTA_URL =
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota'
const HTTP_TIMEOUT_MS = 8000

interface UsageAggregateRow {
  agent_id: string
  sessions: number
  tokens_in: number
  tokens_out: number
  total_cost_usd: number
}

interface ProviderUsageOptions {
  runtimes?: Partial<Record<SupportedAgentId, AgentRuntimeSettings>>
  collectLimit?: (
    agentId: SupportedAgentId,
    runtime?: AgentRuntimeSettings,
  ) => Promise<ProviderUsageRow['limit']>
}

interface ParsedLimitBucket {
  usedPercent: number | null
  windowDurationMins: number | null
  resetsAt: number | null
}

export async function listProviderUsage(
  db: Database.Database,
  adapters: ReadonlyMap<SupportedAgentId, AgentAdapter>,
  now = Date.now(),
  options: ProviderUsageOptions = {},
): Promise<ProviderUsageSummary> {
  const period = currentMonthPeriod(now)
  const usageByAgent = new Map<SupportedAgentId, UsageAggregateRow>()
  const rows = db
    .prepare(
      `
        SELECT
          agent_id,
          COUNT(*) AS sessions,
          COALESCE(SUM(tokens_in), 0) AS tokens_in,
          COALESCE(SUM(tokens_out), 0) AS tokens_out,
          COALESCE(SUM(cost_usd), 0) AS total_cost_usd
        FROM sessions
        WHERE created_at >= ? AND created_at < ?
        GROUP BY agent_id
      `,
    )
    .all(period.startedAt, period.endsAt) as UsageAggregateRow[]

  for (const row of rows) {
    if (isSupportedAgentId(row.agent_id)) usageByAgent.set(row.agent_id, row)
  }

  const providers = await Promise.all(
    SUPPORTED_AGENT_IDS.map(async (agentId): Promise<ProviderUsageRow> => {
      const usage = usageByAgent.get(agentId)
      const adapter = adapters.get(agentId)
      const installed = adapter ? await adapter.isInstalled().catch(() => false) : false

      return {
        agentId,
        name: AGENT_LABELS[agentId],
        installed,
        sessions: Number(usage?.sessions ?? 0),
        tokensIn: Number(usage?.tokens_in ?? 0),
        tokensOut: Number(usage?.tokens_out ?? 0),
        totalCostUsd: Number(usage?.total_cost_usd ?? 0),
        limit: installed
          ? await collectProviderLimit(agentId, options)
          : providerLimitUnavailable('CLI not installed', 'Install and authenticate the CLI to load subscription usage.'),
      }
    }),
  )

  return {
    generatedAt: now,
    periodStartedAt: period.startedAt,
    periodEndsAt: period.endsAt,
    providers,
  }
}

function currentMonthPeriod(now: number): { startedAt: number; endsAt: number } {
  const date = new Date(now)
  const startedAt = new Date(date.getFullYear(), date.getMonth(), 1).getTime()
  const endsAt = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime()

  return { startedAt, endsAt }
}

async function collectProviderLimit(
  agentId: SupportedAgentId,
  options: ProviderUsageOptions,
): Promise<ProviderUsageRow['limit']> {
  try {
    return await (options.collectLimit ?? collectCliProviderLimit)(
      agentId,
      options.runtimes?.[agentId],
    )
  } catch (error) {
    return providerLimitError(error)
  }
}

async function collectCliProviderLimit(
  agentId: SupportedAgentId,
  runtime?: AgentRuntimeSettings,
): Promise<ProviderUsageRow['limit']> {
  if (agentId === 'claude-code') return collectClaudeUsage(runtime)
  if (agentId === 'opencode') return collectOpenCodeUsage(runtime)
  if (agentId === 'codex') return collectCodexUsage(runtime)
  if (agentId === 'antigravity') return collectAntigravityUsage()

  return providerLimitUnavailable(
    'Quota telemetry unavailable',
    'This CLI does not expose stable local quota/reset telemetry yet.',
  )
}

async function collectClaudeUsage(
  runtime?: AgentRuntimeSettings,
): Promise<ProviderUsageRow['limit']> {
  const oauthResult = await collectClaudeOauthUsage().catch(() => null)
  if (oauthResult) return oauthResult

  return collectClaudeCliUsage(runtime)
}

async function collectClaudeOauthUsage(): Promise<ProviderUsageRow['limit'] | null> {
  const token = await readClaudeOauthToken()
  if (!token) return null

  const response = await fetchJsonWithTimeout(ANTHROPIC_OAUTH_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'lobrecs-agent/usage',
    },
  })

  return parseAnthropicOauthUsage(response)
}

async function collectClaudeCliUsage(
  runtime?: AgentRuntimeSettings,
): Promise<ProviderUsageRow['limit']> {
  const command = resolveCommand('CLAUDE_COMMAND', 'claude', runtime?.command)
  let output: string

  try {
    output = await runCommandText(command, ['-p', '--output-format', 'json', '--no-session-persistence', '/usage'], {
      timeout: HTTP_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
    })
  } catch {
    output = await runCommandText(command, ['-p', '--output-format', 'json', '/usage'], {
      timeout: HTTP_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
    })
  }

  const contextOutput = await runCommandText(
    command,
    ['-p', '--output-format', 'json', '--no-session-persistence', '/context'],
    {
      timeout: HTTP_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
    },
  ).catch(() => '')

  return parseClaudeUsage(output, contextOutput)
}

async function collectAntigravityUsage(): Promise<ProviderUsageRow['limit']> {
  const credentials = await readGeminiOauthCredentials()
  if (!credentials) {
    return providerLimitUnavailable(
      'Antigravity login required',
      'Sign in to Antigravity (or run `antigravity login`) to load remote quota telemetry. No Google OAuth credentials were found on disk.',
      'antigravity',
    )
  }

  const response = await fetchJsonWithTimeout(ANTIGRAVITY_QUOTA_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })

  return parseAntigravityQuota(response)
}

async function collectCodexUsage(
  runtime?: AgentRuntimeSettings,
): Promise<ProviderUsageRow['limit']> {
  const command = resolveCommand('CODEX_COMMAND', 'codex', runtime?.command)
  const result = await readCodexAppServerRateLimits(command)

  return parseCodexRateLimits(result)
}

async function collectOpenCodeUsage(
  runtime?: AgentRuntimeSettings,
): Promise<ProviderUsageRow['limit']> {
  const command = resolveCommand('OPENCODE_COMMAND', 'opencode', runtime?.command)
  const output = await runCommandText(command, ['stats', '--days', '7', '--models', '10'], {
    timeout: 8000,
    maxBuffer: 2 * 1024 * 1024,
  })

  return parseOpenCodeStats(output)
}

export function parseClaudeUsage(output: string, contextOutput = ''): ProviderUsageRow['limit'] {
  const payload = parseJsonObject(output)
  const rawResult = typeof payload?.result === 'string' ? payload.result : output
  const usageDetail =
    compactWhitespace(stripAnsi(rawResult)) || 'Claude Code returned usage telemetry.'
  const context = parseClaudeContextUsage(contextOutput)
  const percent = percentFromText(usageDetail)
  const detail = [
    usageDetail,
    context ? `Context window, not subscription quota: ${context.detail}.` : null,
  ]
    .filter(Boolean)
    .join(' ')

  return {
    status: 'available',
    label: percent === null ? 'Subscription usage loaded' : `${formatPercent(percent)} used`,
    detail,
    resetsAt: null,
    usedPercent: percent,
    source: 'claude /usage',
  }
}

const CLAUDE_OAUTH_WINDOW_LABELS: Record<string, { label: string; windowMinutes: number }> = {
  five_hour: { label: 'Session', windowMinutes: 300 },
  seven_day: { label: 'Weekly', windowMinutes: 10080 },
  seven_day_opus: { label: 'Weekly Opus', windowMinutes: 10080 },
  seven_day_sonnet: { label: 'Weekly Sonnet', windowMinutes: 10080 },
  seven_day_cowork: { label: 'Weekly Cowork', windowMinutes: 10080 },
  seven_day_omelette: { label: 'Weekly Designs', windowMinutes: 10080 },
  seven_day_oauth_apps: { label: 'Weekly OAuth apps', windowMinutes: 10080 },
  seven_day_design: { label: 'Designs', windowMinutes: 10080 },
  seven_day_routines: { label: 'Daily Routines', windowMinutes: 10080 },
}

export function parseAnthropicOauthUsage(payload: unknown): ProviderUsageRow['limit'] {
  const root = asRecord(payload)
  if (!root) {
    return providerLimitUnavailable(
      'Unexpected usage payload',
      'Anthropic /api/oauth/usage returned a non-object response.',
      'claude.ai api',
    )
  }

  const primary = parseAnthropicBucket(root.five_hour)
  const weekly = parseAnthropicBucket(root.seven_day)
  const namedDetails: string[] = []

  for (const [key, value] of Object.entries(root)) {
    if (key === 'five_hour' || key === 'seven_day' || key === 'extra_usage') continue
    const meta = CLAUDE_OAUTH_WINDOW_LABELS[key]
    if (!meta) continue
    const bucket = parseAnthropicBucket(value)
    if (!bucket || bucket.usedPercent === null) continue
    namedDetails.push(
      `${meta.label} ${formatPercent(bucket.usedPercent)} used${
        bucket.resetsAt ? `, resets ${new Date(bucket.resetsAt).toLocaleString()}` : ''
      }`,
    )
  }

  if (!primary && !weekly && namedDetails.length === 0) {
    return providerLimitUnavailable(
      'Subscription usage empty',
      'Anthropic returned a usage payload without any rate-limit buckets for this account.',
      'claude.ai api',
    )
  }

  const headlinePercent = primary?.usedPercent ?? weekly?.usedPercent ?? null
  const headlineWindow = primary
    ? formatWindowDuration(300)
    : weekly
      ? formatWindowDuration(10080)
      : null
  const label =
    headlinePercent === null
      ? 'Subscription usage loaded'
      : headlineWindow
        ? `${formatPercent(headlinePercent)} used in ${headlineWindow} window`
        : `${formatPercent(headlinePercent)} used`

  const detailParts = [
    primary
      ? `Session 5h ${formatPercent(primary.usedPercent ?? 0)} used${
          primary.resetsAt ? `, resets ${new Date(primary.resetsAt).toLocaleString()}` : ''
        }`
      : null,
    weekly
      ? `Weekly 7d ${formatPercent(weekly.usedPercent ?? 0)} used${
          weekly.resetsAt ? `, resets ${new Date(weekly.resetsAt).toLocaleString()}` : ''
        }`
      : null,
    ...namedDetails,
    parseAnthropicExtraUsage(root.extra_usage),
  ].filter((part): part is string => Boolean(part))

  return {
    status: 'available',
    label,
    detail: detailParts.join('; ') || 'Anthropic returned subscription usage telemetry.',
    resetsAt: primary?.resetsAt ?? weekly?.resetsAt ?? null,
    usedPercent: headlinePercent,
    source: 'claude.ai api',
  }
}

export function parseAntigravityQuota(payload: unknown): ProviderUsageRow['limit'] {
  const root = asRecord(payload)
  const buckets = Array.isArray(root?.buckets) ? (root.buckets as unknown[]) : []
  if (buckets.length === 0) {
    return providerLimitUnavailable(
      'Quota telemetry empty',
      'Antigravity returned no quota buckets for this account.',
      'antigravity api',
    )
  }

  const parsed = buckets
    .map((bucket) => parseAntigravityBucket(bucket))
    .filter((bucket): bucket is NonNullable<ReturnType<typeof parseAntigravityBucket>> => bucket !== null)

  if (parsed.length === 0) {
    return providerLimitUnavailable(
      'Quota telemetry malformed',
      'Antigravity quota buckets did not include usable fraction or model fields.',
      'antigravity api',
    )
  }

  const headline = parsed.reduce((worst, bucket) =>
    bucket.usedPercent > worst.usedPercent ? bucket : worst,
  )
  const detail = parsed
    .map(
      (bucket) =>
        `${bucket.modelId} ${formatPercent(bucket.usedPercent)} used${
          bucket.resetsAt ? `, resets ${new Date(bucket.resetsAt).toLocaleString()}` : ''
        }`,
    )
    .join('; ')

  return {
    status: 'available',
    label:
      headline.usedPercent === 0
        ? 'Antigravity quota fully available'
        : `${formatPercent(headline.usedPercent)} used (${headline.modelId})`,
    detail,
    resetsAt: headline.resetsAt,
    usedPercent: headline.usedPercent,
    source: 'antigravity api',
  }
}

export function parseCodexRateLimits(payload: unknown): ProviderUsageRow['limit'] {
  const root = asRecord(payload)
  const rateLimits = asRecord(root?.rateLimits)
  const primary = parseCodexBucket(rateLimits?.primary)
  const secondary = parseCodexBucket(rateLimits?.secondary)
  const rateLimitReachedType =
    typeof rateLimits?.rateLimitReachedType === 'string'
      ? rateLimits.rateLimitReachedType
      : null
  const planType = typeof rateLimits?.planType === 'string' ? rateLimits.planType : null
  const credits = asRecord(rateLimits?.credits)
  const creditBalance = typeof credits?.balance === 'string' ? credits.balance : null
  const namedLimitDetails = parseNamedCodexLimits(root?.rateLimitsByLimitId)

  if (!primary && !secondary) {
    return providerLimitUnavailable(
      'Rate limits unavailable',
      'Codex app-server did not return rate-limit buckets for this account.',
      'codex app-server',
    )
  }

  const windowLabel = primary?.windowDurationMins
    ? formatWindowDuration(primary.windowDurationMins)
    : 'primary'
  const label =
    primary?.usedPercent === null || primary?.usedPercent === undefined
      ? 'Codex limits loaded'
      : `${formatPercent(primary.usedPercent)} used in ${windowLabel} window`
  const detailParts = [
    primary ? `Primary ${formatBucketDetail(primary)}` : null,
    secondary ? `Weekly ${formatBucketDetail(secondary)}` : null,
    planType ? `Plan ${planType}` : null,
    creditBalance ? `Credits ${creditBalance}` : null,
    rateLimitReachedType ? `Limit state ${rateLimitReachedType}` : null,
    ...namedLimitDetails,
  ].filter(Boolean)

  return {
    status: 'available',
    label,
    detail: detailParts.join('; ') || 'Codex app-server returned rate-limit telemetry.',
    resetsAt: primary?.resetsAt ?? null,
    usedPercent: primary?.usedPercent ?? null,
    source: 'codex app-server',
  }
}

function parseOpenCodeStats(output: string): ProviderUsageRow['limit'] {
  const text = stripAnsi(output)
  const sessions = firstMatch(text, /Sessions\s+([0-9.,KMB]+)\b/i)
  const messages = firstMatch(text, /Messages\s+([0-9.,KMB]+)\b/i)
  const cost = firstMatch(text, /Total Cost\s+\$([0-9.,]+)/i)
  const input = firstMatch(text, /Input\s+([0-9.,KMB]+)\b/i)
  const outputTokens = firstMatch(text, /Output\s+([0-9.,KMB]+)\b/i)
  const cacheRead = firstMatch(text, /Cache Read\s+([0-9.,KMB]+)\b/i)
  const cacheWrite = firstMatch(text, /Cache Write\s+([0-9.,KMB]+)\b/i)
  const detailParts = [
    sessions ? `${sessions} sessions` : null,
    messages ? `${messages} messages` : null,
    cost ? `$${cost} total cost` : null,
    input ? `${input} input` : null,
    outputTokens ? `${outputTokens} output` : null,
    cacheRead ? `${cacheRead} cache read` : null,
    cacheWrite ? `${cacheWrite} cache write` : null,
  ].filter(Boolean)

  return {
    status: 'available',
    label: cost ? `Last 7 days: $${cost}` : 'Last 7 days loaded',
    detail:
      `${detailParts.join(', ') || 'OpenCode returned usage statistics.'}. ` +
      'OpenCode stats does not expose remaining quota or reset timestamps; OpenCode Go plan limits are account-level.',
    resetsAt: null,
    usedPercent: null,
    source: 'opencode stats',
  }
}

function providerLimitUnavailable(
  label = 'Limit unavailable',
  detail = 'This CLI does not expose stable quota or reset telemetry yet.',
  source?: string,
): ProviderUsageRow['limit'] {
  return {
    status: 'unavailable',
    label,
    detail,
    resetsAt: null,
    usedPercent: null,
    source,
  }
}

function providerLimitError(error: unknown): ProviderUsageRow['limit'] {
  return {
    status: 'error',
    label: 'Usage command failed',
    detail: error instanceof Error ? error.message : 'Unable to load CLI usage telemetry.',
    resetsAt: null,
    usedPercent: null,
  }
}

function isSupportedAgentId(value: string): value is SupportedAgentId {
  return SUPPORTED_AGENT_IDS.includes(value as SupportedAgentId)
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function percentFromText(value: string): number | null {
  const match = value.match(/(\d+(?:\.\d+)?)\s*%\s+used/i)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function formatPercent(value: number): string {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`
}

function firstMatch(value: string, pattern: RegExp): string | null {
  return value.match(pattern)?.[1] ?? null
}

function parseClaudeContextUsage(output: string): { usedPercent: number; detail: string } | null {
  const payload = parseJsonObject(output)
  const rawResult = typeof payload?.result === 'string' ? payload.result : output
  const text = stripAnsi(rawResult)
  const tokensLine = firstMatch(text, /\*\*Tokens:\*\*\s*([^\n]+)/i)
  if (!tokensLine) return null

  const percentMatch = tokensLine.match(/\((\d+(?:\.\d+)?)%\)/)
  const usedPercent = percentMatch ? Number(percentMatch[1]) : Number.NaN
  if (!Number.isFinite(usedPercent)) return null

  return {
    usedPercent,
    detail: compactWhitespace(tokensLine),
  }
}

function parseCodexBucket(value: unknown): ParsedLimitBucket | null {
  const bucket = asRecord(value)
  if (!bucket) return null

  return {
    usedPercent: numberOrNull(bucket.usedPercent),
    windowDurationMins: numberOrNull(bucket.windowDurationMins),
    resetsAt: unixSecondsToMilliseconds(numberOrNull(bucket.resetsAt)),
  }
}

function parseNamedCodexLimits(value: unknown): string[] {
  const byLimitId = asRecord(value)
  if (!byLimitId) return []

  return Object.values(byLimitId)
    .map((entry) => {
      const limit = asRecord(entry)
      if (!limit) return null
      const name =
        typeof limit.limitName === 'string' && limit.limitName.trim()
          ? limit.limitName.trim()
          : typeof limit.limitId === 'string'
            ? limit.limitId
            : null
      if (!name) return null
      const primary = parseCodexBucket(limit.primary)
      const secondary = parseCodexBucket(limit.secondary)
      if (!primary && !secondary) return null

      return `${name}: ${[primary ? formatBucketDetail(primary) : null, secondary ? `weekly ${formatBucketDetail(secondary)}` : null]
        .filter(Boolean)
        .join(', ')}`
    })
    .filter((detail): detail is string => Boolean(detail))
}

function formatBucketDetail(bucket: ParsedLimitBucket): string {
  const parts = [
    bucket.windowDurationMins ? formatWindowDuration(bucket.windowDurationMins) : null,
    bucket.usedPercent === null ? null : `${formatPercent(bucket.usedPercent)} used`,
    bucket.resetsAt ? `resets ${new Date(bucket.resetsAt).toLocaleString()}` : null,
  ].filter(Boolean)

  return parts.join(' ') || 'loaded'
}

function formatWindowDuration(minutes: number): string {
  if (minutes % (60 * 24) === 0) return `${minutes / (60 * 24)}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

function unixSecondsToMilliseconds(value: number | null): number | null {
  if (value === null) return null
  return value > 10_000_000_000 ? value : value * 1000
}

function parseAnthropicBucket(value: unknown): ParsedLimitBucket | null {
  const bucket = asRecord(value)
  if (!bucket) return null

  const usedPercent = numberOrNull(bucket.utilization)
  const resetsAtRaw = bucket.resets_at ?? bucket.resetsAt
  const resetsAt = typeof resetsAtRaw === 'string' ? Date.parse(resetsAtRaw) : null

  if (usedPercent === null && !resetsAt) return null

  return {
    usedPercent,
    windowDurationMins: null,
    resetsAt: Number.isFinite(resetsAt as number) ? (resetsAt as number) : null,
  }
}

function parseAnthropicExtraUsage(value: unknown): string | null {
  const extra = asRecord(value)
  if (!extra || extra.is_enabled !== true) return null

  const used = numberOrNull(extra.used_credits)
  const limit = numberOrNull(extra.monthly_limit)
  const currency = typeof extra.currency === 'string' ? ` ${extra.currency}` : ''

  if (used === null && limit === null) return null

  return `Extra credits ${used ?? '?'}/${limit ?? '?'}${currency}`
}

function parseAntigravityBucket(value: unknown): {
  modelId: string
  usedPercent: number
  resetsAt: number | null
} | null {
  const bucket = asRecord(value)
  if (!bucket) return null

  const modelId = typeof bucket.modelId === 'string' ? bucket.modelId : null
  const remaining = numberOrNull(bucket.remainingFraction)
  if (!modelId || remaining === null) return null

  const resetsAtRaw = typeof bucket.resetTime === 'string' ? Date.parse(bucket.resetTime) : NaN

  return {
    modelId,
    usedPercent: Math.max(0, Math.min(100, Math.round((1 - remaining) * 1000) / 10)),
    resetsAt: Number.isFinite(resetsAtRaw) ? resetsAtRaw : null,
  }
}

async function readClaudeOauthToken(): Promise<string | null> {
  const fromKeychain = await readClaudeKeychainToken()
  if (fromKeychain) return fromKeychain

  return readClaudeCredentialFile()
}

async function readClaudeKeychainToken(): Promise<string | null> {
  if (platform() !== 'darwin') return null

  try {
    const { stdout } = await execFileAsync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { timeout: 4000 },
    )
    return extractClaudeAccessToken(stdout)
  } catch {
    return null
  }
}

async function readClaudeCredentialFile(): Promise<string | null> {
  try {
    const filePath = path.join(homedir(), '.claude', '.credentials.json')
    const text = await readFile(filePath, 'utf8')
    return extractClaudeAccessToken(text)
  } catch {
    return null
  }
}

function extractClaudeAccessToken(raw: string): string | null {
  const payload = parseJsonObject(raw.trim())
  const oauth = asRecord(payload?.claudeAiOauth)
  const token = oauth?.accessToken
  if (typeof token !== 'string' || !token) return null

  const expiresAt = numberOrNull(oauth?.expiresAt)
  if (expiresAt !== null && expiresAt < Date.now()) return null

  return token
}

async function readGeminiOauthCredentials(): Promise<{ accessToken: string } | null> {
  try {
    const filePath = path.join(homedir(), '.gemini', 'oauth_creds.json')
    const text = await readFile(filePath, 'utf8')
    const payload = parseJsonObject(text)
    const accessToken = typeof payload?.access_token === 'string' ? payload.access_token : null
    if (!accessToken) return null

    const expiry = numberOrNull(payload?.expiry_date)
    if (expiry !== null && expiry < Date.now()) return null

    return { accessToken }
  } catch {
    return null
  }
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
    }
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

function readCodexAppServerRateLimits(command: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['app-server', '--listen', 'stdio://'], {
      env: buildProcessEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const readId = 3
    const timeout = setTimeout(() => {
      finish(new Error('Timed out while reading Codex rate limits.'))
    }, 8000)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      for (const line of lines) handleCodexLine(line)
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => finish(error))
    child.on('exit', () => {
      if (!settled) finish(new Error(compactWhitespace(stderr) || 'Codex app-server exited before returning rate limits.'))
    })

    child.stdin.write(
      [
        JSON.stringify({
          id: 1,
          method: 'initialize',
          params: {
            clientInfo: {
              name: 'lobrecs_agent',
              title: 'Lobrecs Agent',
              version: '0.0.0',
            },
          },
        }),
        JSON.stringify({ method: 'initialized' }),
        JSON.stringify({ id: readId, method: 'account/rateLimits/read' }),
      ].join('\n') + '\n',
    )

    function handleCodexLine(line: string): void {
      const message = parseJsonObject(line)
      if (!message || message.id !== readId) return

      const error = asRecord(message.error)
      if (error) {
        const errorMessage = typeof error.message === 'string' ? error.message : 'Codex rate-limit request failed.'
        finish(new Error(errorMessage))
        return
      }

      finish(null, message.result)
    }

    function finish(error: Error | null, result?: unknown): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (!child.killed) child.kill()
      if (error) {
        reject(error)
        return
      }
      resolve(result)
    }
  })
}
