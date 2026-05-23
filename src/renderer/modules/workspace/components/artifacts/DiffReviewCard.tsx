import type { GitDiffReviewFinding, GitDiffReviewResult } from '../../../../../shared/types'
import { Button } from '../../../../components/ui'

export interface DiffReviewCardProps {
  result: GitDiffReviewResult | null
  loading?: boolean
  error?: string | null
  onReview: () => void | Promise<void>
  onFix: (result: GitDiffReviewResult) => void | Promise<void>
  onOpenAgentPanel?: () => void
}

export function DiffReviewCard({
  result,
  loading = false,
  error,
  onReview,
  onFix,
  onOpenAgentPanel,
}: DiffReviewCardProps) {
  const hasFindings = Boolean(result && result.findings.length > 0)

  return (
    <article className="rounded-card border border-hairline/70 bg-card/40">
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-secondary">Post-run diff check</div>
          <div className="mt-0.5 text-[11px] text-muted">
            Read-only review of the current working tree.
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {hasFindings && result ? (
            <Button variant="ghost" size="sm" onClick={() => void onFix(result)}>
              Fix with agent
            </Button>
          ) : null}
          {onOpenAgentPanel ? (
            <Button variant="ghost" size="sm" onClick={onOpenAgentPanel}>
              Agents
            </Button>
          ) : null}
          <Button variant="chip" size="sm" loading={loading} onClick={() => void onReview()}>
            {loading ? 'Reviewing' : 'Review'}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="border-t border-hairline/70 px-3 py-2 text-xs leading-5 text-secondary">
          A read-only review agent is running in this thread. Open Agents to watch
          the session instead of waiting on a silent spinner.
        </div>
      ) : null}

      {error ? (
        <div className="border-t border-accent-del/40 bg-accent-del/10 px-4 py-2 text-xs text-accent-del">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="border-t border-hairline/70 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{result.statusSummary}</span>
            <span>{result.analysis.agentId}</span>
            <span>{result.analysis.model}</span>
            {result.analysis.sessionId ? (
              <span>session {result.analysis.sessionId.slice(0, 8)}</span>
            ) : null}
          </div>
          <div className="mt-2 text-sm leading-6 text-primary">{result.summary}</div>
          {result.findings.length > 0 ? (
            <ol className="mt-3 flex flex-col gap-2">
              {result.findings.map((finding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
            </ol>
          ) : (
            <div className="mt-3 rounded-card border border-accent-add/30 bg-accent-add/10 px-3 py-2 text-xs text-accent-add">
              No concrete findings returned.
            </div>
          )}
        </div>
      ) : null}
    </article>
  )
}

function FindingRow({ finding }: { finding: GitDiffReviewFinding }) {
  return (
    <li className="rounded-card border border-hairline bg-card-raised px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={severityClass(finding.severity)}>{finding.severity}</span>
        <span className="rounded border border-hairline bg-card px-2 py-0.5 text-[11px] text-secondary">
          {finding.category}
        </span>
        {finding.filePath ? (
          <span className="min-w-0 truncate font-mono text-[11px] text-muted">
            {finding.filePath}
            {finding.line ? `:${finding.line}` : ''}
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-sm font-medium text-primary">{finding.title}</div>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-secondary">
        {finding.detail}
      </p>
      {finding.recommendation ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted">
          {finding.recommendation}
        </p>
      ) : null}
    </li>
  )
}

function severityClass(severity: GitDiffReviewFinding['severity']): string {
  if (severity === 'critical' || severity === 'high') {
    return 'rounded border border-accent-del/40 bg-accent-del/10 px-2 py-0.5 text-[11px] text-accent-del'
  }
  if (severity === 'medium') {
    return 'rounded border border-accent-warn/40 bg-accent-warn/10 px-2 py-0.5 text-[11px] text-accent-warn'
  }
  return 'rounded border border-hairline bg-card px-2 py-0.5 text-[11px] text-secondary'
}
