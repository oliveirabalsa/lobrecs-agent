import type Database from 'better-sqlite3'
import type { AgentAdapter } from '../../../agents'
import { resolveCommand, runCommandText } from '../../../agents/command'
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
  if (agentId === 'codex') {
    return providerLimitUnavailable(
      'Quota telemetry unavailable',
      'Codex CLI does not expose a stable non-interactive subscription usage command yet.',
    )
  }

  return providerLimitUnavailable(
    'Quota telemetry unavailable',
    'This CLI does not expose stable quota or reset telemetry yet.',
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

  return parseClaudeUsage(output)
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

function parseClaudeUsage(output: string): ProviderUsageRow['limit'] {
  const payload = parseJsonObject(output)
  const rawResult = typeof payload?.result === 'string' ? payload.result : output
  const detail = compactWhitespace(stripAnsi(rawResult)) || 'Claude Code returned usage telemetry.'
  const percent = percentFromText(detail)

  return {
    status: 'available',
    label: percent === null ? 'Subscription usage loaded' : `${formatPercent(percent)} used`,
    detail,
    resetsAt: null,
    usedPercent: percent,
    source: 'claude /usage',
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
    detail: detailParts.join(', ') || 'OpenCode returned usage statistics.',
    resetsAt: null,
    usedPercent: null,
    source: 'opencode stats',
  }
}

function providerLimitUnavailable(label = 'Limit unavailable', detail = 'This CLI does not expose stable quota or reset telemetry yet.'): ProviderUsageRow['limit'] {
  return {
    status: 'unavailable',
    label,
    detail,
    resetsAt: null,
    usedPercent: null,
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
