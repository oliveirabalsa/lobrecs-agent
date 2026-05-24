import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import type { AgentAdapter } from '../../../agents'
import type { SupportedAgentId } from '../../../../shared/types'
import {
  listProviderUsage,
  parseAnthropicOauthUsage,
  parseAntigravityQuota,
  parseClaudeUsage,
  parseCodexRateLimits,
} from './providerUsage'

describe('listProviderUsage', () => {
  it('aggregates current-month usage by supported provider', async () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
    `)

    try {
      const now = new Date(2026, 4, 23, 12).getTime()
      const lastMonth = new Date(2026, 3, 30, 12).getTime()
      db.prepare(
        `
          INSERT INTO sessions (
            id, project_id, agent_id, model, prompt, status,
            tokens_in, tokens_out, cost_usd, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run('s1', 'p1', 'codex', 'gpt-5.5', 'one', 'done', 100, 50, 0.25, now)
      db.prepare(
        `
          INSERT INTO sessions (
            id, project_id, agent_id, model, prompt, status,
            tokens_in, tokens_out, cost_usd, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run('s2', 'p1', 'codex', 'gpt-5.4', 'two', 'done', 10, 5, 0.05, now)
      db.prepare(
        `
          INSERT INTO sessions (
            id, project_id, agent_id, model, prompt, status,
            tokens_in, tokens_out, cost_usd, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run('s3', 'p1', 'claude-code', 'sonnet', 'old', 'done', 500, 500, 1.5, lastMonth)

      const summary = await listProviderUsage(db, createAdapters(['codex']), now, {
        collectLimit: async () => ({
          status: 'available',
          label: '19% used',
          detail: 'Current week loaded from CLI.',
          resetsAt: null,
          usedPercent: 19,
          source: 'test-cli',
        }),
      })
      const codex = summary.providers.find((provider) => provider.agentId === 'codex')
      const claude = summary.providers.find((provider) => provider.agentId === 'claude-code')

      expect(summary.periodStartedAt).toBe(new Date(2026, 4, 1).getTime())
      expect(summary.periodEndsAt).toBe(new Date(2026, 5, 1).getTime())
      expect(codex).toMatchObject({
        installed: true,
        sessions: 2,
        tokensIn: 110,
        tokensOut: 55,
        totalCostUsd: 0.3,
        limit: {
          status: 'available',
          label: '19% used',
          usedPercent: 19,
          resetsAt: null,
        },
      })
      expect(claude).toMatchObject({
        installed: false,
        sessions: 0,
        totalCostUsd: 0,
      })
    } finally {
      db.close()
    }
  })

  it('marks installed providers with failed CLI telemetry as an error instead of failing the page', async () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
    `)

    try {
      const summary = await listProviderUsage(db, createAdapters(['claude-code']), Date.now(), {
        collectLimit: async () => {
          throw new Error('usage command failed')
        },
      })
      const claude = summary.providers.find((provider) => provider.agentId === 'claude-code')

      expect(claude).toMatchObject({
        installed: true,
        limit: {
          status: 'error',
          label: 'Usage command failed',
          detail: 'usage command failed',
          usedPercent: null,
        },
      })
    } finally {
      db.close()
    }
  })
})

describe('provider usage CLI parsers', () => {
  it('maps Codex app-server rate-limit buckets into visible reset telemetry', () => {
    const limit = parseCodexRateLimits({
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 37, windowDurationMins: 300, resetsAt: 1779522567 },
        secondary: { usedPercent: 22, windowDurationMins: 10080, resetsAt: 1779824197 },
        credits: { hasCredits: false, unlimited: false, balance: '0' },
        planType: 'prolite',
        rateLimitReachedType: null,
      },
      rateLimitsByLimitId: {
        codex_spark: {
          limitId: 'codex_spark',
          limitName: 'GPT-5.3-Codex-Spark',
          primary: { usedPercent: 19, windowDurationMins: 300, resetsAt: 1779520394 },
          secondary: { usedPercent: 16, windowDurationMins: 10080, resetsAt: 1779824495 },
        },
      },
    })

    expect(limit).toMatchObject({
      status: 'available',
      label: '37% used in 5h window',
      resetsAt: 1779522567 * 1000,
      usedPercent: 37,
      source: 'codex app-server',
    })
    expect(limit.detail).toContain('Weekly 7d 22% used')
    expect(limit.detail).toContain('Plan prolite')
    expect(limit.detail).toContain('GPT-5.3-Codex-Spark')
  })

  it('keeps Claude context-window usage out of the subscription quota meter', () => {
    const limit = parseClaudeUsage(
      JSON.stringify({
        result: 'You are currently using your subscription to power your Claude Code usage',
      }),
      JSON.stringify({
        result: '## Context Usage\n\n**Tokens:** 38.7k / 1m (4%)\n',
      }),
    )

    expect(limit).toMatchObject({
      status: 'available',
      label: 'Subscription usage loaded',
      usedPercent: null,
      source: 'claude /usage',
    })
    expect(limit.detail).toContain('Context window, not subscription quota: 38.7k / 1m (4%)')
  })

  it('maps the Anthropic OAuth usage payload into session + weekly buckets', () => {
    const limit = parseAnthropicOauthUsage({
      five_hour: { utilization: 24, resets_at: '2026-05-24T13:10:00.915990+00:00' },
      seven_day: { utilization: 20, resets_at: '2026-05-28T20:00:00.916012+00:00' },
      seven_day_opus: null,
      seven_day_sonnet: { utilization: 20, resets_at: '2026-05-28T20:00:00.916019+00:00' },
      seven_day_omelette: { utilization: 0, resets_at: null },
      extra_usage: {
        is_enabled: false,
        monthly_limit: null,
        used_credits: null,
        utilization: null,
        currency: null,
      },
    })

    expect(limit).toMatchObject({
      status: 'available',
      label: '24% used in 5h window',
      usedPercent: 24,
      source: 'claude.ai api',
      resetsAt: Date.parse('2026-05-24T13:10:00.915990+00:00'),
    })
    expect(limit.detail).toContain('Session 5h 24% used')
    expect(limit.detail).toContain('Weekly 7d 20% used')
    expect(limit.detail).toContain('Weekly Sonnet 20% used')
    expect(limit.detail).not.toContain('Opus')
    expect(limit.detail).not.toContain('Extra credits')
  })

  it('falls back gracefully when the Anthropic payload has no buckets', () => {
    const limit = parseAnthropicOauthUsage({
      five_hour: null,
      seven_day: null,
      extra_usage: { is_enabled: false },
    })

    expect(limit.status).toBe('unavailable')
    expect(limit.label).toBe('Subscription usage empty')
  })

  it('maps Antigravity quota buckets into the worst-case headline percent', () => {
    const limit = parseAntigravityQuota({
      buckets: [
        {
          resetTime: '2026-05-25T08:21:00Z',
          tokenType: 'REQUESTS',
          modelId: 'gemini-2.5-pro',
          remainingFraction: 0.75,
        },
        {
          resetTime: '2026-05-25T08:21:00Z',
          tokenType: 'REQUESTS',
          modelId: 'gemini-2.5-flash',
          remainingFraction: 1,
        },
      ],
    })

    expect(limit).toMatchObject({
      status: 'available',
      label: '25% used (gemini-2.5-pro)',
      usedPercent: 25,
      source: 'antigravity api',
      resetsAt: Date.parse('2026-05-25T08:21:00Z'),
    })
    expect(limit.detail).toContain('gemini-2.5-pro 25% used')
    expect(limit.detail).toContain('gemini-2.5-flash 0% used')
  })

  it('marks Antigravity as unavailable when the API returns no buckets', () => {
    const limit = parseAntigravityQuota({ buckets: [] })

    expect(limit.status).toBe('unavailable')
    expect(limit.label).toBe('Quota telemetry empty')
  })

  it('uses Claude usage percentage only when /usage itself exposes one', () => {
    const limit = parseClaudeUsage(
      JSON.stringify({
        result: 'Weekly usage: 72% used. Resets soon.',
      }),
      JSON.stringify({
        result: '## Context Usage\n\n**Tokens:** 38.7k / 1m (4%)\n',
      }),
    )

    expect(limit).toMatchObject({
      status: 'available',
      label: '72% used',
      usedPercent: 72,
      source: 'claude /usage',
    })
  })
})

function createAdapters(installedAgentIds: SupportedAgentId[]): Map<SupportedAgentId, AgentAdapter> {
  return new Map(
    installedAgentIds.map((agentId) => [
      agentId,
      {
        id: agentId,
        name: agentId,
        isInstalled: vi.fn().mockResolvedValue(true),
        dispatch: vi.fn(),
      } as unknown as AgentAdapter,
    ]),
  )
}
