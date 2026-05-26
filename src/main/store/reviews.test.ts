import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, setDbForTests } from './db'
import { reviewIssuesStore } from './reviews'
import type { GitDiffReviewResult } from '../../shared/types'

describe('reviewIssuesStore', () => {
  beforeEach(() => {
    setDbForTests(new Database(':memory:'))
    seedProject('project-1')
    seedSession('session-1', 'project-1')
    seedSession('session-fix', 'project-1')
  })

  afterEach(() => {
    closeDb()
  })

  it('persists local diff review findings as active review issues', () => {
    const issues = reviewIssuesStore.saveDiffReviewIssues({
      result: diffReviewResult({
        findings: [
          {
            id: 'finding-1',
            severity: 'high',
            category: 'bug',
            title: 'State leaks between threads',
            detail: 'The previous thread proposal can render in the new thread.',
            filePath: 'src/workspace.tsx',
            line: 42,
            recommendation: 'Scope proposals by thread id.',
          },
        ],
      }),
      sessionId: 'session-1',
      threadId: 'thread-1',
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      projectId: 'project-1',
      provider: 'local-diff-review',
      sourceId: 'fingerprint-1:finding-1',
      severity: 'high',
      category: 'bug',
      title: 'State leaks between threads',
      filePath: 'src/workspace.tsx',
      line: 42,
      status: 'open',
      sessionId: 'session-1',
      threadId: 'thread-1',
    })

    const snapshot = reviewIssuesStore.list({ projectId: 'project-1', status: 'active' })
    expect(snapshot.counts.open).toBe(1)
    expect(snapshot.issues.map((issue) => issue.id)).toEqual([issues[0].id])
  })

  it('updates repeated findings without reopening resolved issues', () => {
    const [issue] = reviewIssuesStore.saveDiffReviewIssues({
      result: diffReviewResult({
        findings: [
          {
            id: 'finding-1',
            severity: 'medium',
            category: 'missing-test',
            title: 'Missing test',
            detail: 'Add coverage.',
          },
        ],
      }),
    })

    reviewIssuesStore.update(issue.id, { status: 'resolved' })
    reviewIssuesStore.saveDiffReviewIssues({
      result: diffReviewResult({
        findings: [
          {
            id: 'finding-1',
            severity: 'high',
            category: 'missing-test',
            title: 'Missing regression test',
            detail: 'Add coverage for the thread leak.',
          },
        ],
      }),
    })

    const snapshot = reviewIssuesStore.list({ projectId: 'project-1', status: 'all' })
    expect(snapshot.issues).toHaveLength(1)
    expect(snapshot.issues[0]).toMatchObject({
      status: 'resolved',
      severity: 'high',
      title: 'Missing regression test',
    })
    expect(snapshot.counts.resolved).toBe(1)
  })

  it('marks an issue as fixing with the spawned fix session id', () => {
    const [issue] = reviewIssuesStore.saveDiffReviewIssues({
      result: diffReviewResult({
        findings: [
          {
            id: 'finding-1',
            severity: 'low',
            category: 'verification',
            title: 'Run build',
            detail: 'The build was not verified.',
          },
        ],
      }),
    })

    const updated = reviewIssuesStore.update(issue.id, {
      status: 'fixing',
      fixSessionId: 'session-fix',
    })

    expect(updated).toMatchObject({
      status: 'fixing',
      fixSessionId: 'session-fix',
    })
    expect(reviewIssuesStore.list({ projectId: 'project-1' }).counts.fixing).toBe(1)
  })

  describe('savePrReviewIssues', () => {
    it('persists PR findings stamped with github provider and PR metadata', () => {
      const issues = reviewIssuesStore.savePrReviewIssues({
        result: diffReviewResult({
          findings: [
            {
              id: 'finding-1',
              severity: 'high',
              category: 'bug',
              title: 'Missing null guard',
              detail: 'Dereferences possibly-undefined user.',
              filePath: 'src/handler.ts',
              line: 88,
            },
          ],
        }),
        prNumber: 42,
        prUrl: 'https://github.com/owner/repo/pull/42',
        headSha: 'abc123',
        threadId: 'thread-1',
      })

      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({
        provider: 'github',
        providerRef: '42',
        sourceUrl: 'https://github.com/owner/repo/pull/42',
        fingerprint: 'abc123',
        sourceId: 'gh:42:abc123:finding-1',
        status: 'open',
        threadId: 'thread-1',
      })
    })

    it('upserts the same PR + same head sha without creating duplicates', () => {
      reviewIssuesStore.savePrReviewIssues({
        result: diffReviewResult({
          findings: [
            { id: 'finding-1', severity: 'low', category: 'bug', title: 'A', detail: 'd' },
          ],
        }),
        prNumber: 5,
        headSha: 'sha-a',
      })
      reviewIssuesStore.savePrReviewIssues({
        result: diffReviewResult({
          findings: [
            {
              id: 'finding-1',
              severity: 'high',
              category: 'bug',
              title: 'A updated',
              detail: 'd2',
            },
          ],
        }),
        prNumber: 5,
        headSha: 'sha-a',
      })

      const snapshot = reviewIssuesStore.list({ projectId: 'project-1', status: 'all' })
      expect(snapshot.issues).toHaveLength(1)
      expect(snapshot.issues[0]).toMatchObject({
        title: 'A updated',
        severity: 'high',
        providerRef: '5',
      })
    })

    it('creates a new row for the same PR after a force-push (different head sha)', () => {
      reviewIssuesStore.savePrReviewIssues({
        result: diffReviewResult({
          findings: [
            { id: 'finding-1', severity: 'low', category: 'bug', title: 'A', detail: 'd' },
          ],
        }),
        prNumber: 9,
        headSha: 'sha-old',
      })
      reviewIssuesStore.savePrReviewIssues({
        result: diffReviewResult({
          findings: [
            { id: 'finding-1', severity: 'low', category: 'bug', title: 'A', detail: 'd' },
          ],
        }),
        prNumber: 9,
        headSha: 'sha-new',
      })

      const snapshot = reviewIssuesStore.list({ projectId: 'project-1', status: 'all' })
      expect(snapshot.issues).toHaveLength(2)
      expect(snapshot.issues.map((i) => i.fingerprint).sort()).toEqual(['sha-new', 'sha-old'])
    })

    it('filters by prNumber so the inbox can scope to a single PR', () => {
      reviewIssuesStore.savePrReviewIssues({
        result: diffReviewResult({
          findings: [
            { id: 'finding-1', severity: 'low', category: 'bug', title: 'A', detail: 'd' },
          ],
        }),
        prNumber: 1,
        headSha: 'sha-1',
      })
      reviewIssuesStore.savePrReviewIssues({
        result: diffReviewResult({
          findings: [
            { id: 'finding-1', severity: 'low', category: 'bug', title: 'B', detail: 'd' },
          ],
        }),
        prNumber: 2,
        headSha: 'sha-2',
      })

      const snapshot = reviewIssuesStore.list({ projectId: 'project-1', prNumber: 2 })
      expect(snapshot.issues).toHaveLength(1)
      expect(snapshot.issues[0]?.title).toBe('B')
    })

    it('rejects invalid pr numbers and missing head sha', () => {
      expect(() =>
        reviewIssuesStore.savePrReviewIssues({
          result: diffReviewResult({
            findings: [
              { id: 'finding-1', severity: 'low', category: 'bug', title: 'A', detail: 'd' },
            ],
          }),
          prNumber: 0,
          headSha: 'sha',
        }),
      ).toThrow('Invalid pull request number')

      expect(() =>
        reviewIssuesStore.savePrReviewIssues({
          result: diffReviewResult({
            findings: [
              { id: 'finding-1', severity: 'low', category: 'bug', title: 'A', detail: 'd' },
            ],
          }),
          prNumber: 1,
          headSha: '',
        }),
      ).toThrow('head sha')
    })
  })
})

function seedProject(projectId: string): void {
  const now = Date.now()
  getDb()
    .prepare(
      `
        INSERT INTO projects (
          id, name, repo_path, agent_id, model_tier, context, created_at, updated_at
        )
        VALUES (?, 'Test Project', '/tmp/test-project', 'codex', 'balanced', NULL, ?, ?)
      `,
    )
    .run(projectId, now, now)
}

function seedSession(sessionId: string, projectId: string): void {
  const now = Date.now()
  getDb()
    .prepare(
      `
        INSERT INTO sessions (
          id, project_id, agent_id, model, prompt, status,
          tokens_in, tokens_out, cost_usd, created_at, completed_at
        )
        VALUES (?, ?, 'codex', 'gpt-5', 'Prompt', 'done', 0, 0, 0, ?, ?)
      `,
    )
    .run(sessionId, projectId, now, now)
}

function diffReviewResult(
  partial: Pick<GitDiffReviewResult, 'findings'>,
): GitDiffReviewResult {
  return {
    projectId: 'project-1',
    fingerprint: 'fingerprint-1',
    branch: 'main',
    statusSummary: '1 file changed',
    changedFiles: [{ path: 'src/workspace.tsx', status: 'modified' }],
    summary: 'Review found issues.',
    rawOutput: undefined,
    analysis: {
      agentId: 'codex',
      model: 'gpt-5',
    },
    findings: partial.findings,
  }
}
