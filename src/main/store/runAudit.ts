import { randomUUID } from 'node:crypto'
import type {
  RunAuditPhase,
  RunAuditRecord,
  RunAuditStopReason,
  VisualEvidenceRecord,
} from '../../shared/types'
import { getDb } from './db'

type RunAuditRow = {
  id: string
  spec_run_id: string | null
  session_id: string
  thread_id: string | null
  attempt: number
  phase: RunAuditPhase
  recipe_id: string | null
  recipe_label: string | null
  command: string | null
  exit_code: number | null
  output_tail: string | null
  changed_files: string | null
  repair_session_id: string | null
  stop_reason: RunAuditStopReason | null
  final_status: 'passed' | 'failed' | 'pending' | null
  visual_evidence: string | null
  created_at: number
}

export interface CreateRunAuditInput {
  specRunId?: string
  sessionId: string
  threadId?: string
  attempt: number
  phase: RunAuditPhase
  recipeId?: string
  recipeLabel?: string
  command?: string
  exitCode?: number
  outputTail?: string
  changedFiles?: string[]
  repairSessionId?: string
  stopReason?: RunAuditStopReason
  finalStatus?: 'passed' | 'failed' | 'pending'
  visualEvidence?: VisualEvidenceRecord
}

function rowToRecord(row: RunAuditRow): RunAuditRecord {
  return {
    id: row.id,
    specRunId: row.spec_run_id ?? undefined,
    sessionId: row.session_id,
    threadId: row.thread_id ?? undefined,
    attempt: row.attempt,
    phase: row.phase,
    recipeId: row.recipe_id ?? undefined,
    recipeLabel: row.recipe_label ?? undefined,
    command: row.command ?? undefined,
    exitCode: row.exit_code ?? undefined,
    outputTail: row.output_tail ?? undefined,
    changedFiles: row.changed_files ? (JSON.parse(row.changed_files) as string[]) : undefined,
    repairSessionId: row.repair_session_id ?? undefined,
    stopReason: row.stop_reason ?? undefined,
    finalStatus: row.final_status ?? undefined,
    visualEvidence: parseVisualEvidence(row.visual_evidence),
    createdAt: row.created_at,
  }
}

function parseVisualEvidence(value: string | null): VisualEvidenceRecord | undefined {
  if (!value) return undefined
  return JSON.parse(value) as VisualEvidenceRecord
}

export const runAuditStore = {
  create(input: CreateRunAuditInput): RunAuditRecord {
    const id = randomUUID()
    const now = Date.now()

    getDb()
      .prepare(
        `
          INSERT INTO run_audit_records (
            id, spec_run_id, session_id, thread_id, attempt, phase,
            recipe_id, recipe_label, command, exit_code, output_tail,
            changed_files, repair_session_id, stop_reason, final_status, visual_evidence,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        input.specRunId ?? null,
        input.sessionId,
        input.threadId ?? null,
        input.attempt,
        input.phase,
        input.recipeId ?? null,
        input.recipeLabel ?? null,
        input.command ?? null,
        input.exitCode ?? null,
        input.outputTail ?? null,
        input.changedFiles ? JSON.stringify(input.changedFiles) : null,
        input.repairSessionId ?? null,
        input.stopReason ?? null,
        input.finalStatus ?? null,
        input.visualEvidence ? JSON.stringify(input.visualEvidence) : null,
        now,
      )

    return rowToRecord(
      getDb()
        .prepare('SELECT * FROM run_audit_records WHERE id = ?')
        .get(id) as RunAuditRow,
    )
  },

  listForSpecRun(specRunId: string): RunAuditRecord[] {
    const rows = getDb()
      .prepare(
        'SELECT * FROM run_audit_records WHERE spec_run_id = ? ORDER BY created_at ASC, rowid ASC',
      )
      .all(specRunId) as RunAuditRow[]

    return rows.map(rowToRecord)
  },

  listForSession(sessionId: string): RunAuditRecord[] {
    const rows = getDb()
      .prepare(
        'SELECT * FROM run_audit_records WHERE session_id = ? ORDER BY created_at ASC, rowid ASC',
      )
      .all(sessionId) as RunAuditRow[]

    return rows.map(rowToRecord)
  },
}
