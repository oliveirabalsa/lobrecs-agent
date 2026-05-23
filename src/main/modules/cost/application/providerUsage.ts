import type Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
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

  return providerLimitUnavailable(
    'Quota telemetry unavailable',
    'Antigravity CLI plan limits depend on Google AI plan status, but the CLI does not expose stable local quota/reset telemetry yet.',
    'antigravity docs',
  )
}

async function collectClaudeUsage(
  runtime?: AgentRuntimeSettings,
): Promise<ProviderUsageRow['limit']> {
  const command = resolveCommand('CLAUDE_COMMAND', 'claude', runtime?.command)
  let output: string

  try {
    output = await runCommandText(command, ['-p', '--output-format', 'json', '--no-session-persistence', '/usage'], {
      timeout: 8000,
      maxBuffer: 2 * 1024 * 1024,
    })
  } catch {
    output = await runCommandText(command, ['-p', '--output-format', 'json', '/usage'], {
      timeout: 8000,
      maxBuffer: 2 * 1024 * 1024,
    })
  }

  const contextOutput = await runCommandText(
    command,
    ['-p', '--output-format', 'json', '--no-session-persistence', '/context'],
    {
      timeout: 8000,
      maxBuffer: 2 * 1024 * 1024,
    },
  ).catch(() => '')

  return parseClaudeUsage(output, contextOutput)
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
