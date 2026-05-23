import type { RunAuditPhase, RunAuditRecord } from '../../../../../shared/types'

export interface RunAuditTimelineCardProps {
  records: RunAuditRecord[]
}

export type RunAuditCommandStatus = 'running' | 'passed' | 'failed' | 'stopped'

export interface RunAuditCommandRow {
  command: string
  status: RunAuditCommandStatus
  attempt: number
  exitCode?: number
}

const STATUS_LABEL: Record<RunAuditCommandStatus, string> = {
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  stopped: 'Stopped',
}

const STATUS_TONE: Record<RunAuditCommandStatus, string> = {
  running: 'border-accent-primary/25 bg-accent-primary/5 text-accent-primary',
  passed: 'border-accent-add/25 bg-accent-add/5 text-accent-add',
  failed: 'border-accent-del/30 bg-accent-del/5 text-accent-del',
  stopped: 'border-accent-warn/30 bg-accent-warn/5 text-accent-warn',
}

export function RunAuditTimelineCard({ records }: RunAuditTimelineCardProps) {
  const rows = deriveRunAuditCommandRows(records)
  if (rows.length === 0) return null

  return (
    <div className="flex flex-col gap-1 self-start text-[11px] text-muted">
      {rows.map((row) => (
        <div
          key={row.command}
          className="inline-flex max-w-full items-center gap-2 rounded-pill border border-hairline bg-card/60 px-2 py-1"
        >
          <span
            className={`shrink-0 rounded-pill border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE[row.status]}`}
          >
            {STATUS_LABEL[row.status]}
          </span>
          <span className="min-w-0 truncate font-mono text-secondary" title={row.command}>
            {row.command}
          </span>
          {row.exitCode !== undefined && row.exitCode !== 0 ? (
            <span className="shrink-0 text-[10px] tabular-nums text-muted">
              exit {row.exitCode}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export function deriveRunAuditCommandRows(
  records: readonly RunAuditRecord[],
): RunAuditCommandRow[] {
  const byCommand = new Map<string, RunAuditCommandRow>()

  for (const record of records) {
    const command = record.command?.trim()
    if (!command) continue

    byCommand.set(command, {
      command,
      status: statusForPhase(record.phase, record.finalStatus),
      attempt: record.attempt,
      exitCode: record.exitCode,
    })
  }

  return [...byCommand.values()]
}

function statusForPhase(
  phase: RunAuditPhase,
  finalStatus: RunAuditRecord['finalStatus'],
): RunAuditCommandStatus {
  if (finalStatus === 'passed') return 'passed'
  if (finalStatus === 'failed') return 'failed'

  switch (phase) {
    case 'recipe-started':
      return 'running'
    case 'recipe-passed':
    case 'gate-passed':
      return 'passed'
    case 'recipe-failed':
    case 'repair-dispatched':
      return 'failed'
    case 'gate-stopped':
      return 'stopped'
    case 'repair-skipped':
      return 'stopped'
    default: {
      const _exhaustive: never = phase
      return _exhaustive
    }
  }
}
