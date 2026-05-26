import type {
  RunAuditPhase,
  RunAuditRecord,
  VisualEvidenceRecord,
} from '../../../../../shared/types'

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

export interface VisualEvidenceRow {
  id: string
  status: VisualEvidenceRecord['status']
  url: string
  finalUrl?: string
  title?: string
  viewport: string
  screenshotDataUrl?: string
  consoleErrorCount: number
  networkFailureCount: number
  replayNotes?: string
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
  const evidenceRows = deriveVisualEvidenceRows(records)
  const phases = deriveRunAuditPhaseRows(records)
  if (rows.length === 0 && phases.length === 0 && evidenceRows.length === 0) return null

  return (
    <div className="flex w-full max-w-2xl flex-col gap-2 self-start rounded-card border border-hairline bg-card/60 p-2 text-[11px] text-muted">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-secondary">QA timeline</span>
        <span className="text-[10px] text-muted">{records.length} events</span>
      </div>
      {rows.length > 0 ? (
        <div className="flex flex-col gap-1">
          {rows.map((row) => (
            <div
              key={row.command}
              className="inline-flex max-w-full items-center gap-2 rounded-pill border border-hairline bg-canvas/50 px-2 py-1"
            >
              <span
                className={`shrink-0 rounded-pill border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE[row.status]}`}
              >
                {STATUS_LABEL[row.status]}
              </span>
              <span className="min-w-0 truncate font-mono text-secondary" title={row.command}>
                {row.command}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-muted">
                attempt {row.attempt + 1}
              </span>
              {row.exitCode !== undefined && row.exitCode !== 0 ? (
                <span className="shrink-0 text-[10px] tabular-nums text-muted">
                  exit {row.exitCode}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {evidenceRows.length > 0 ? (
        <div className="grid gap-2">
          {evidenceRows.map((row) => (
            <div
              key={row.id}
              className="grid gap-2 rounded-card border border-hairline bg-canvas/40 p-2 sm:grid-cols-[96px_minmax(0,1fr)]"
            >
              <div className="flex aspect-video items-center justify-center overflow-hidden rounded border border-hairline bg-card">
                {row.screenshotDataUrl ? (
                  <img
                    src={row.screenshotDataUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="px-2 text-center text-[10px] text-muted">No image</span>
                )}
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`shrink-0 rounded-pill border px-1.5 py-0.5 text-[10px] font-medium ${
                      row.status === 'captured'
                        ? 'border-accent-add/25 bg-accent-add/5 text-accent-add'
                        : 'border-accent-del/30 bg-accent-del/5 text-accent-del'
                    }`}
                  >
                    {row.status === 'captured' ? 'Captured' : 'Failed'}
                  </span>
                  <span className="min-w-0 truncate text-secondary" title={row.title ?? row.url}>
                    {row.title ?? row.finalUrl ?? row.url}
                  </span>
                </div>
                <div className="truncate font-mono text-[10px]" title={row.finalUrl ?? row.url}>
                  {row.finalUrl ?? row.url}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
                  <span>{row.viewport}</span>
                  <span>{row.consoleErrorCount} console errors</span>
                  <span>{row.networkFailureCount} network failures</span>
                </div>
                {row.replayNotes ? (
                  <div className="line-clamp-2 text-[10px] text-muted">{row.replayNotes}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {phases.length > 0 ? (
        <div className="grid gap-1">
          {phases.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 rounded border border-hairline/70 bg-canvas/40 px-2 py-1.5"
            >
              <span className="text-[10px] uppercase text-muted">{row.phase}</span>
              <span className="min-w-0 truncate text-secondary" title={row.detail}>
                {row.detail}
              </span>
            </div>
          ))}
        </div>
      ) : null}
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

export function deriveVisualEvidenceRows(
  records: readonly RunAuditRecord[],
): VisualEvidenceRow[] {
  return records
    .map((record) => record.visualEvidence)
    .filter((evidence): evidence is VisualEvidenceRecord => Boolean(evidence))
    .map((evidence) => ({
      id: evidence.id,
      status: evidence.status,
      url: evidence.url,
      finalUrl: evidence.finalUrl,
      title: evidence.title,
      viewport: `${evidence.viewport.width}x${evidence.viewport.height}${
        evidence.viewport.deviceScaleFactor && evidence.viewport.deviceScaleFactor !== 1
          ? ` @${evidence.viewport.deviceScaleFactor}x`
          : ''
      }`,
      screenshotDataUrl: evidence.screenshot?.dataUrl,
      consoleErrorCount: evidence.consoleErrors.length,
      networkFailureCount: evidence.networkFailures.length,
      replayNotes: evidence.replayNotes,
    }))
}

function deriveRunAuditPhaseRows(records: readonly RunAuditRecord[]) {
  return records.slice(-5).map((record) => {
    const detail = [
      record.recipeLabel,
      record.stopReason ? `stop: ${record.stopReason}` : null,
      record.repairSessionId ? `repair ${record.repairSessionId.slice(0, 8)}` : null,
      record.changedFiles?.length ? `${record.changedFiles.length} files` : null,
    ]
      .filter(Boolean)
      .join(' · ')

    return {
      id: record.id,
      phase: labelForPhase(record.phase),
      detail: detail || record.finalStatus || 'Recorded',
    }
  })
}

function labelForPhase(phase: RunAuditPhase): string {
  switch (phase) {
    case 'recipe-started':
      return 'started'
    case 'recipe-passed':
      return 'passed'
    case 'recipe-failed':
      return 'failed'
    case 'visual-captured':
      return 'visual'
    case 'visual-failed':
      return 'visual'
    case 'repair-dispatched':
      return 'repair'
    case 'repair-skipped':
      return 'skipped'
    case 'gate-passed':
      return 'gate ok'
    case 'gate-stopped':
      return 'stopped'
    default: {
      const _exhaustive: never = phase
      return _exhaustive
    }
  }
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
    case 'visual-failed':
      return 'failed'
    case 'visual-captured':
      return 'passed'
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
