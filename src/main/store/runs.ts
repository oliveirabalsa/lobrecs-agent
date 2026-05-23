import { randomUUID } from 'node:crypto'
import type {
  RunAttempt,
  RunAttemptStatus,
  RunMode,
  SpecRun,
  SpecRunComparison,
  SpecRunStatus,
  SupportedAgentId,
  VerificationResult,
  VerificationStatus,
} from '../../shared/types'
import { getDb } from './db'
import { specsStore } from './specs'

type SpecRunRow = {
  id: string
  spec_id: string
  status: SpecRunStatus
  mode: RunMode
  created_at: number
  completed_at: number | null
}

type RunAttemptRow = {
  id: string
  spec_run_id: string
  session_id: string | null
  agent_id: SupportedAgentId
  model: string | null
  status: RunAttemptStatus
  cost_usd: number | null
  duration_ms: number | null
  risk: 'low' | 'medium' | 'high' | null
  created_at: number
  completed_at: number | null
}

type VerificationResultRow = {
  id: string
  spec_run_id: string
  command: string
  status: VerificationStatus
  output: string | null
  created_at: number
  completed_at: number | null
}

function rowToRun(row: SpecRunRow): SpecRun {
  return {
    id: row.id,
    specId: row.spec_id,
    status: row.status,
    mode: 'local',
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  }
}

function rowToAttempt(row: RunAttemptRow): RunAttempt {
  return {
    id: row.id,
    specRunId: row.spec_run_id,
    sessionId: row.session_id ?? undefined,
    agentId: row.agent_id,
    model: row.model ?? undefined,
    status: row.status,
    costUsd: row.cost_usd ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    risk: row.risk ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  }
}

function rowToVerification(row: VerificationResultRow): VerificationResult {
  return {
    id: row.id,
    specRunId: row.spec_run_id,
    command: row.command,
    status: row.status,
    output: row.output ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  }
}

export const specRunsStore = {
  get(runId: string): SpecRun | null {
    const row = getDb().prepare('SELECT * FROM spec_runs WHERE id = ?').get(runId) as
      | SpecRunRow
      | undefined

    return row ? rowToRun(row) : null
  },

  listForSpec(specId: string): SpecRun[] {
    const rows = getDb()
      .prepare('SELECT * FROM spec_runs WHERE spec_id = ? ORDER BY created_at DESC')
      .all(specId) as SpecRunRow[]

    return rows.map(rowToRun)
  },

  start(specId: string, mode?: RunMode): { run: SpecRun; attempts: RunAttempt[] } {
    const spec = specsStore.get(specId)
    if (!spec) {
      throw new Error(`Spec not found: ${specId}`)
    }
    if (spec.status === 'draft') {
      throw new Error('Approve the spec before starting a run')
    }

    const id = randomUUID()
    const now = Date.now()
    const runMode: RunMode = 'local'
    const selectedAgents = spec.selectedAgents.length > 0 ? spec.selectedAgents : ['codex']
    const db = getDb()

    const createRun = db.transaction(() => {
      specsStore.setStatus(specId, 'running')
      db.prepare(
        `
          INSERT INTO spec_runs (id, spec_id, status, mode, created_at, completed_at)
          VALUES (?, ?, 'running', ?, ?, NULL)
        `,
      ).run(id, specId, runMode, now)

      const insertAttempt = db.prepare(
        `
          INSERT INTO run_attempts (
            id, spec_run_id, session_id, agent_id, model, status,
            cost_usd, duration_ms, risk, created_at, completed_at
          )
          VALUES (?, ?, NULL, ?, NULL, 'queued', NULL, NULL, NULL, ?, NULL)
        `,
      )

      selectedAgents.forEach((agentId) => {
        insertAttempt.run(randomUUID(), id, agentId, now)
      })
    })

    createRun()

    return {
      run: requireRun(id),
      attempts: this.listAttempts(id),
    }
  },

  findSpecRunIdBySessionId(sessionId: string): string | null {
    const row = getDb()
      .prepare('SELECT spec_run_id FROM run_attempts WHERE session_id = ? LIMIT 1')
      .get(sessionId) as { spec_run_id: string } | undefined

    return row?.spec_run_id ?? null
  },

  listAttempts(runId: string): RunAttempt[] {
    const rows = getDb()
      .prepare('SELECT * FROM run_attempts WHERE spec_run_id = ? ORDER BY created_at ASC')
      .all(runId) as RunAttemptRow[]

    return rows.map(rowToAttempt)
  },

  updateAttempt(
    attemptId: string,
    data: {
      sessionId?: string | null
      model?: string | null
      status?: RunAttemptStatus
      costUsd?: number | null
      risk?: 'low' | 'medium' | 'high' | null
    },
  ): RunAttempt {
    const attempt = requireAttempt(attemptId)
    const fields: string[] = []
    const values: unknown[] = []

    if (data.sessionId !== undefined) {
      fields.push('session_id = ?')
      values.push(data.sessionId)
    }
    if (data.model !== undefined) {
      fields.push('model = ?')
      values.push(data.model)
    }
    if (data.status !== undefined) {
      fields.push('status = ?')
      values.push(data.status)
      if (isTerminalAttemptStatus(data.status)) {
        const completedAt = Date.now()
        fields.push('completed_at = ?', 'duration_ms = ?')
        values.push(completedAt, completedAt - attempt.createdAt)
      }
    }
    if (data.costUsd !== undefined) {
      fields.push('cost_usd = ?')
      values.push(data.costUsd)
    }
    if (data.risk !== undefined) {
      fields.push('risk = ?')
      values.push(data.risk)
    }

    if (fields.length > 0) {
      values.push(attemptId)
      getDb()
        .prepare(`UPDATE run_attempts SET ${fields.join(', ')} WHERE id = ?`)
        .run(...values)
    }

    return requireAttempt(attemptId)
  },

  complete(runId: string, status: Extract<SpecRunStatus, 'done' | 'failed'>): SpecRun {
    const run = requireRun(runId)
    const now = Date.now()

    getDb()
      .prepare('UPDATE spec_runs SET status = ?, completed_at = ? WHERE id = ?')
      .run(status, now, runId)

    specsStore.setStatus(run.specId, status === 'done' ? 'reviewing' : 'failed')
    return requireRun(runId)
  },

  cancel(runId: string): SpecRun {
    const run = requireRun(runId)
    if (isTerminalRunStatus(run.status)) return run

    const now = Date.now()
    const db = getDb()

    const cancelRun = db.transaction(() => {
      db.prepare('UPDATE spec_runs SET status = ?, completed_at = ? WHERE id = ?').run(
        'cancelled',
        now,
        runId,
      )
      db.prepare(
        `
          UPDATE run_attempts
          SET status = 'cancelled', completed_at = ?, duration_ms = ? - created_at
          WHERE spec_run_id = ? AND status IN ('queued', 'running')
        `,
      ).run(now, now, runId)
      specsStore.setStatus(run.specId, 'failed')
    })

    cancelRun()
    return requireRun(runId)
  },

  createVerification(runId: string, command: string): VerificationResult {
    const run = requireRun(runId)
    if (!isReviewableRunStatus(run.status)) {
      throw new Error('Cannot verify before the agent run has completed')
    }

    const id = randomUUID()
    const now = Date.now()
    getDb()
      .prepare(
        `
          INSERT INTO verification_results (
            id, spec_run_id, command, status, output, created_at, completed_at
          )
          VALUES (?, ?, ?, 'running', NULL, ?, NULL)
        `,
      )
      .run(id, runId, command, now)

    return requireVerification(id)
  },

  finishVerification(
    verificationId: string,
    status: Extract<VerificationStatus, 'passed' | 'failed' | 'skipped'>,
    output: string,
  ): VerificationResult {
    const result = requireVerification(verificationId)
    const run = requireRun(result.specRunId)
    const now = Date.now()

    getDb()
      .prepare(
        `
          UPDATE verification_results
          SET status = ?, output = ?, completed_at = ?
          WHERE id = ?
        `,
      )
      .run(status, output, now, verificationId)

    specsStore.setStatus(run.specId, status === 'passed' ? 'verified' : 'failed')
    return requireVerification(verificationId)
  },

  listVerificationResults(runId: string): VerificationResult[] {
    const rows = getDb()
      .prepare('SELECT * FROM verification_results WHERE spec_run_id = ? ORDER BY created_at ASC')
      .all(runId) as VerificationResultRow[]

    return rows.map(rowToVerification)
  },

  compare(specId: string): SpecRunComparison {
    const runs = this.listForSpec(specId)
    const attempts = runs.flatMap((run) => this.listAttempts(run.id))
    const verificationResults = runs.flatMap((run) => this.listVerificationResults(run.id))

    return { specId, runs, attempts, verificationResults }
  },
}

function requireRun(runId: string): SpecRun {
  const run = specRunsStore.get(runId)
  if (!run) {
    throw new Error(`Spec run not found: ${runId}`)
  }

  return run
}

function requireAttempt(attemptId: string): RunAttempt {
  const row = getDb().prepare('SELECT * FROM run_attempts WHERE id = ?').get(attemptId) as
    | RunAttemptRow
    | undefined

  if (!row) {
    throw new Error(`Run attempt not found: ${attemptId}`)
  }

  return rowToAttempt(row)
}

function requireVerification(verificationId: string): VerificationResult {
  const row = getDb()
    .prepare('SELECT * FROM verification_results WHERE id = ?')
    .get(verificationId) as VerificationResultRow | undefined

  if (!row) {
    throw new Error(`Verification result not found: ${verificationId}`)
  }

  return rowToVerification(row)
}

function isTerminalAttemptStatus(status: RunAttemptStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled'
}

function isTerminalRunStatus(status: SpecRunStatus): boolean {
  return (
    status === 'done' ||
    status === 'reviewing' ||
    status === 'verified' ||
    status === 'failed' ||
    status === 'cancelled'
  )
}

function isReviewableRunStatus(status: SpecRunStatus): boolean {
  return status === 'done' || status === 'reviewing' || status === 'verified'
}
