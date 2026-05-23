import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import type { AgentAdapter } from '../../../agents'
import type { SupportedAgentId } from '../../../../shared/types'
import { listProviderUsage } from './providerUsage'

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
