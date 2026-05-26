import { randomUUID } from 'node:crypto'
import type {
  GitDiffReviewResult,
  ReviewIssue,
  ReviewIssueCategory,
  ReviewIssueListFilter,
  ReviewIssuePatch,
  ReviewIssueProvider,
  ReviewIssueSeverity,
  ReviewIssueSnapshot,
  ReviewIssueStatus,
  ReviewIssueStatusCounts,
} from '../../shared/types'
import { getDb } from './db'

type ReviewIssueRow = {
  id: string
  project_id: string
  provider: ReviewIssueProvider
  source_id: string
  source_url: string | null
  spec_run_id: string | null
  session_id: string | null
  thread_id: string | null
  fingerprint: string | null
  branch: string | null
  severity: ReviewIssueSeverity
  category: ReviewIssueCategory
  title: string
  detail: string
  file_path: string | null
  line: number | null
  recommendation: string | null
  status: ReviewIssueStatus
  fix_session_id: string | null
  created_at: number
  updated_at: number
  resolved_at: number | null
  round_number: number | null
  provider_ref: string | null
  batch_status: string | null
}

export interface SaveDiffReviewIssuesInput {
  result: GitDiffReviewResult
  sessionId?: string
  threadId?: string
  specRunId?: string
}

export interface SavePrReviewIssuesInput {
  result: GitDiffReviewResult
  prNumber: number
  prUrl?: string
  headSha: string
  sessionId?: string
  threadId?: string
}

export const reviewIssuesStore = {
  list(filter: ReviewIssueListFilter): ReviewIssueSnapshot {
    const clauses = ['project_id = ?']
    const values: unknown[] = [filter.projectId]

    if (filter.status && filter.status !== 'all') {
      if (filter.status === 'active') {
        clauses.push("status IN ('open', 'fixing')")
      } else {
        clauses.push('status = ?')
        values.push(filter.status)
      }
    }
    if (filter.sessionId) {
      clauses.push('session_id = ?')
      values.push(filter.sessionId)
    }
    if (filter.threadId) {
      clauses.push('thread_id = ?')
      values.push(filter.threadId)
    }
    if (filter.specRunId) {
      clauses.push('spec_run_id = ?')
      values.push(filter.specRunId)
    }
    if (filter.roundNumber !== undefined) {
      clauses.push('round_number = ?')
      values.push(filter.roundNumber)
    }
    if (filter.provider && filter.provider !== 'all') {
      clauses.push('provider = ?')
      values.push(filter.provider)
    }
    if (filter.prNumber !== undefined) {
      clauses.push('provider_ref = ?')
      values.push(String(filter.prNumber))
    }

    const where = clauses.join(' AND ')
    const rows = getDb()
      .prepare(
        `
          SELECT *
          FROM review_issues
          WHERE ${where}
          ORDER BY
            CASE status
              WHEN 'open' THEN 0
              WHEN 'fixing' THEN 1
              WHEN 'resolved' THEN 2
              ELSE 3
            END,
            CASE severity
              WHEN 'critical' THEN 0
              WHEN 'high' THEN 1
              WHEN 'medium' THEN 2
              ELSE 3
            END,
            updated_at DESC
        `,
      )
      .all(...values) as ReviewIssueRow[]

    return {
      issues: rows.map(rowToReviewIssue),
      counts: countByStatus(filter.projectId),
    }
  },

  saveDiffReviewIssues(input: SaveDiffReviewIssuesInput): ReviewIssue[] {
    if (input.result.findings.length === 0) return []

    const now = Date.now()
    const db = getDb()

    const maxRoundRow = db
      .prepare('SELECT COALESCE(MAX(round_number), 0) AS max_round FROM review_issues WHERE project_id = ?')
      .get(input.result.projectId) as { max_round: number }
    const roundNumber = maxRoundRow.max_round + 1

    const upsert = db.prepare(
      `
        INSERT INTO review_issues (
          id, project_id, provider, source_id, source_url, spec_run_id,
          session_id, thread_id, fingerprint, branch, severity, category,
          title, detail, file_path, line, recommendation, status,
          fix_session_id, round_number, provider_ref, batch_status, created_at, updated_at, resolved_at
        )
        VALUES (
          ?, ?, 'local-diff-review', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'open', NULL, ?, NULL, NULL, ?, ?, NULL
        )
        ON CONFLICT(project_id, provider, source_id) DO UPDATE SET
          spec_run_id = COALESCE(excluded.spec_run_id, review_issues.spec_run_id),
          session_id = COALESCE(excluded.session_id, review_issues.session_id),
          thread_id = COALESCE(excluded.thread_id, review_issues.thread_id),
          fingerprint = excluded.fingerprint,
          branch = excluded.branch,
          severity = excluded.severity,
          category = excluded.category,
          title = excluded.title,
          detail = excluded.detail,
          file_path = excluded.file_path,
          line = excluded.line,
          recommendation = excluded.recommendation,
          round_number = COALESCE(review_issues.round_number, excluded.round_number),
          updated_at = excluded.updated_at
      `,
    )

    const writeIssues = db.transaction(() => {
      for (const finding of input.result.findings) {
        upsert.run(
          randomUUID(),
          input.result.projectId,
          localDiffReviewSourceId(input.result.fingerprint, finding.id),
          input.specRunId ?? null,
          input.sessionId ?? input.result.analysis.sessionId ?? null,
          input.threadId ?? null,
          input.result.fingerprint,
          input.result.branch,
          finding.severity,
          finding.category,
          finding.title.trim(),
          finding.detail.trim(),
          finding.filePath ?? null,
          finding.line ?? null,
          finding.recommendation?.trim() || null,
          roundNumber,
          now,
          now,
        )
      }
    })

    writeIssues()
    return this.list({
      projectId: input.result.projectId,
      status: 'active',
      sessionId: input.sessionId ?? input.result.analysis.sessionId,
    }).issues
  },

  savePrReviewIssues(input: SavePrReviewIssuesInput): ReviewIssue[] {
    if (input.result.findings.length === 0) return []
    if (!Number.isInteger(input.prNumber) || input.prNumber <= 0) {
      throw new Error(`Invalid pull request number: ${input.prNumber}`)
    }
    if (!input.headSha) {
      throw new Error('PR review requires a head sha for dedupe.')
    }

    const now = Date.now()
    const db = getDb()
    const prRef = String(input.prNumber)

    const maxRoundRow = db
      .prepare(
        `SELECT COALESCE(MAX(round_number), 0) AS max_round
           FROM review_issues
          WHERE project_id = ? AND provider = 'github' AND provider_ref = ?`,
      )
      .get(input.result.projectId, prRef) as { max_round: number }
    const roundNumber = maxRoundRow.max_round + 1

    const upsert = db.prepare(
      `
        INSERT INTO review_issues (
          id, project_id, provider, source_id, source_url, spec_run_id,
          session_id, thread_id, fingerprint, branch, severity, category,
          title, detail, file_path, line, recommendation, status,
          fix_session_id, round_number, provider_ref, batch_status, created_at, updated_at, resolved_at
        )
        VALUES (
          ?, ?, 'github', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'open', NULL, ?, ?, NULL, ?, ?, NULL
        )
        ON CONFLICT(project_id, provider, source_id) DO UPDATE SET
          source_url = COALESCE(excluded.source_url, review_issues.source_url),
          session_id = COALESCE(excluded.session_id, review_issues.session_id),
          thread_id = COALESCE(excluded.thread_id, review_issues.thread_id),
          fingerprint = excluded.fingerprint,
          branch = excluded.branch,
          severity = excluded.severity,
          category = excluded.category,
          title = excluded.title,
          detail = excluded.detail,
          file_path = excluded.file_path,
          line = excluded.line,
          recommendation = excluded.recommendation,
          round_number = COALESCE(review_issues.round_number, excluded.round_number),
          provider_ref = excluded.provider_ref,
          updated_at = excluded.updated_at
      `,
    )

    const writeIssues = db.transaction(() => {
      for (const finding of input.result.findings) {
        upsert.run(
          randomUUID(),
          input.result.projectId,
          prReviewSourceId(prRef, input.headSha, finding.id),
          input.prUrl ?? null,
          input.sessionId ?? input.result.analysis.sessionId ?? null,
          input.threadId ?? null,
          input.headSha,
          input.result.branch,
          finding.severity,
          finding.category,
          finding.title.trim(),
          finding.detail.trim(),
          finding.filePath ?? null,
          finding.line ?? null,
          finding.recommendation?.trim() || null,
          roundNumber,
          prRef,
          now,
          now,
        )
      }
    })

    writeIssues()
    return this.list({
      projectId: input.result.projectId,
      status: 'active',
      provider: 'github',
      prNumber: input.prNumber,
    }).issues
  },

  upsertIssues(projectId: string, issues: Array<Omit<ReviewIssue, 'id' | 'createdAt' | 'updatedAt'>>): ReviewIssue[] {
    if (issues.length === 0) return []

    const now = Date.now()
    const db = getDb()

    const upsert = db.prepare(
      `
        INSERT INTO review_issues (
          id, project_id, provider, source_id, source_url, spec_run_id,
          session_id, thread_id, fingerprint, branch, severity, category,
          title, detail, file_path, line, recommendation, status,
          fix_session_id, round_number, provider_ref, batch_status, created_at, updated_at, resolved_at
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(project_id, provider, source_id) DO UPDATE SET
          source_url = COALESCE(excluded.source_url, review_issues.source_url),
          spec_run_id = COALESCE(excluded.spec_run_id, review_issues.spec_run_id),
          session_id = COALESCE(excluded.session_id, review_issues.session_id),
          thread_id = COALESCE(excluded.thread_id, review_issues.thread_id),
          fingerprint = COALESCE(excluded.fingerprint, review_issues.fingerprint),
          branch = COALESCE(excluded.branch, review_issues.branch),
          severity = excluded.severity,
          category = excluded.category,
          title = excluded.title,
          detail = excluded.detail,
          file_path = excluded.file_path,
          line = excluded.line,
          recommendation = excluded.recommendation,
          status = COALESCE(review_issues.status, excluded.status),
          round_number = COALESCE(review_issues.round_number, excluded.round_number),
          provider_ref = COALESCE(review_issues.provider_ref, excluded.provider_ref),
          batch_status = COALESCE(review_issues.batch_status, excluded.batch_status),
          updated_at = excluded.updated_at
      `,
    )

    const writeIssues = db.transaction(() => {
      for (const issue of issues) {
        upsert.run(
          randomUUID(),
          projectId,
          issue.provider,
          issue.sourceId,
          issue.sourceUrl ?? null,
          issue.specRunId ?? null,
          issue.sessionId ?? null,
          issue.threadId ?? null,
          issue.fingerprint ?? null,
          issue.branch ?? null,
          issue.severity,
          issue.category,
          issue.title,
          issue.detail,
          issue.filePath ?? null,
          issue.line ?? null,
          issue.recommendation ?? null,
          issue.status,
          issue.fixSessionId ?? null,
          issue.roundNumber ?? null,
          issue.providerRef ?? null,
          issue.batchStatus ?? null,
          now,
          now,
          issue.resolvedAt ?? null,
        )
      }
    })

    writeIssues()
    return this.list({ projectId }).issues
  },

  update(issueId: string, patch: ReviewIssuePatch): ReviewIssue {
    const issue = requireReviewIssue(issueId)
    const fields: string[] = []
    const values: unknown[] = []
    const now = Date.now()

    if (patch.status !== undefined && patch.status !== issue.status) {
      fields.push('status = ?')
      values.push(patch.status)
      fields.push('resolved_at = ?')
      values.push(patch.status === 'resolved' || patch.status === 'ignored' ? now : null)
    }
    if (patch.fixSessionId !== undefined) {
      fields.push('fix_session_id = ?')
      values.push(patch.fixSessionId)
    }
    if (patch.roundNumber !== undefined) {
      fields.push('round_number = ?')
      values.push(patch.roundNumber)
    }
    if (patch.providerRef !== undefined) {
      fields.push('provider_ref = ?')
      values.push(patch.providerRef)
    }
    if (patch.batchStatus !== undefined) {
      fields.push('batch_status = ?')
      values.push(patch.batchStatus)
    }

    if (fields.length > 0) {
      fields.push('updated_at = ?')
      values.push(now, issueId)
      getDb()
        .prepare(`UPDATE review_issues SET ${fields.join(', ')} WHERE id = ?`)
        .run(...values)
    }

    return requireReviewIssue(issueId)
  },
}

function rowToReviewIssue(row: ReviewIssueRow): ReviewIssue {
  return {
    id: row.id,
    projectId: row.project_id,
    provider: row.provider,
    sourceId: row.source_id,
    sourceUrl: row.source_url ?? undefined,
    specRunId: row.spec_run_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    threadId: row.thread_id ?? undefined,
    fingerprint: row.fingerprint ?? undefined,
    branch: row.branch ?? undefined,
    severity: row.severity,
    category: row.category,
    title: row.title,
    detail: row.detail,
    filePath: row.file_path ?? undefined,
    line: row.line ?? undefined,
    recommendation: row.recommendation ?? undefined,
    status: row.status,
    fixSessionId: row.fix_session_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at ?? undefined,
    roundNumber: row.round_number ?? undefined,
    providerRef: row.provider_ref ?? undefined,
    batchStatus: (row.batch_status as any) ?? undefined,
  }
}

function requireReviewIssue(issueId: string): ReviewIssue {
  const row = getDb().prepare('SELECT * FROM review_issues WHERE id = ?').get(issueId) as
    | ReviewIssueRow
    | undefined

  if (!row) {
    throw new Error(`Review issue not found: ${issueId}`)
  }

  return rowToReviewIssue(row)
}

function countByStatus(projectId: string): ReviewIssueStatusCounts {
  const rows = getDb()
    .prepare(
      `
        SELECT status, COUNT(*) AS count
        FROM review_issues
        WHERE project_id = ?
        GROUP BY status
      `,
    )
    .all(projectId) as Array<{ status: ReviewIssueStatus; count: number }>

  const counts: ReviewIssueStatusCounts = {
    open: 0,
    fixing: 0,
    resolved: 0,
    ignored: 0,
  }

  for (const row of rows) {
    counts[row.status] = row.count
  }

  return counts
}

function localDiffReviewSourceId(fingerprint: string, findingId: string): string {
  return `${fingerprint}:${findingId}`
}

function prReviewSourceId(prRef: string, headSha: string, findingId: string): string {
  return `gh:${prRef}:${headSha}:${findingId}`
}
