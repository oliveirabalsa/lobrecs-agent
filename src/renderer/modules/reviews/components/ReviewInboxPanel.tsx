import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  Project,
  ReviewIssue,
  ReviewIssuePatch,
  ReviewIssueSnapshot,
} from '../../../../shared/types'
import { Button } from '../../../components/ui'
import type { StartedSessionSummary } from '../../sessions/types'

interface ReviewInboxPanelProps {
  project: Project
  activeThreadId?: string | null
  onSessionStarted?: (session: StartedSessionSummary) => void
}

type ReviewFilter = 'active' | 'all'

const EMPTY_SNAPSHOT: ReviewIssueSnapshot = {
  issues: [],
  counts: { open: 0, fixing: 0, resolved: 0, ignored: 0 },
}

export function ReviewInboxPanel({
  project,
  activeThreadId,
  onSessionStarted,
}: ReviewInboxPanelProps) {
  const [snapshot, setSnapshot] = useState<ReviewIssueSnapshot>(EMPTY_SNAPSHOT)
  const [filter, setFilter] = useState<ReviewFilter>('active')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyIssueId, setBusyIssueId] = useState<string | null>(null)

  const activeCount = snapshot.counts.open + snapshot.counts.fixing

  const loadIssues = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await window.agentforge.reviews.list({
        projectId: project.id,
        status: filter,
      })
      setSnapshot(next)
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load review issues.')
    } finally {
      setLoading(false)
    }
  }, [filter, project.id])

  useEffect(() => {
    void loadIssues()
  }, [loadIssues])

  const visibleIssues = useMemo(() => snapshot.issues, [snapshot.issues])

  async function updateIssue(issue: ReviewIssue, patch: ReviewIssuePatch) {
    setBusyIssueId(issue.id)
    setError(null)
    try {
      await window.agentforge.reviews.update(issue.id, patch)
      await loadIssues()
    } catch (updateError: unknown) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update review issue.')
    } finally {
      setBusyIssueId(null)
    }
  }

  async function fixIssue(issue: ReviewIssue) {
    setBusyIssueId(issue.id)
    setError(null)
    try {
      const createdAt = Date.now()
      const prompt = buildFixPrompt(issue)
      const result = await window.agentforge.agent.dispatch({
        projectId: project.id,
        threadId: activeThreadId ?? issue.threadId,
        prompt,
      })
      await window.agentforge.reviews.update(issue.id, {
        status: 'fixing',
        fixSessionId: result.sessionId,
      })
      onSessionStarted?.({
        sessionId: result.sessionId,
        threadId: result.threadId,
        prompt,
        routingDecision: null,
        createdAt,
      })
      await loadIssues()
    } catch (fixError: unknown) {
      setError(fixError instanceof Error ? fixError.message : 'Failed to start fix session.')
    } finally {
      setBusyIssueId(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="shrink-0 border-b border-hairline px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-primary">Review Inbox</h2>
            <div className="mt-0.5 text-[11px] text-muted">
              {activeCount} active · {snapshot.counts.resolved} resolved
            </div>
          </div>
          <Button variant="ghost" size="sm" loading={loading} onClick={() => void loadIssues()}>
            Refresh
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-1">
          <FilterButton active={filter === 'active'} onClick={() => setFilter('active')}>
            Active
          </FilterButton>
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </FilterButton>
        </div>
      </div>

      {error ? (
        <div className="shrink-0 border-b border-accent-del/40 bg-accent-del/10 px-3 py-2 text-xs text-accent-del">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {visibleIssues.length > 0 ? (
          <div className="flex flex-col gap-2">
            {visibleIssues.map((issue) => (
              <ReviewIssueCard
                key={issue.id}
                issue={issue}
                busy={busyIssueId === issue.id}
                onFix={() => void fixIssue(issue)}
                onResolve={() => void updateIssue(issue, { status: 'resolved' })}
                onIgnore={() => void updateIssue(issue, { status: 'ignored' })}
                onReopen={() => void updateIssue(issue, { status: 'open', fixSessionId: null })}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-[12px] leading-5 text-muted">
            {loading
              ? 'Loading review issues.'
              : 'No review issues yet. Run a post-run diff check to populate this inbox.'}
          </div>
        )}
      </div>
    </div>
  )
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
        active
          ? 'bg-white/10 text-primary'
          : 'text-muted hover:bg-white/5 hover:text-secondary'
      }`}
    >
      {children}
    </button>
  )
}

function ReviewIssueCard({
  issue,
  busy,
  onFix,
  onResolve,
  onIgnore,
  onReopen,
}: {
  issue: ReviewIssue
  busy: boolean
  onFix: () => void
  onResolve: () => void
  onIgnore: () => void
  onReopen: () => void
}) {
  const closed = issue.status === 'resolved' || issue.status === 'ignored'

  return (
    <article className="rounded-card border border-hairline bg-card/60 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={severityClass(issue.severity)}>{issue.severity}</Badge>
            <Badge className="border-hairline bg-card-raised text-muted">{issue.category}</Badge>
            <Badge className="border-hairline bg-card-raised text-muted">{issue.status}</Badge>
          </div>
          <h3 className="mt-2 text-[13px] font-semibold leading-5 text-primary">
            {issue.title}
          </h3>
        </div>
      </div>

      {issue.filePath ? (
        <div className="mt-2 truncate font-mono text-[11px] text-muted">
          {issue.filePath}
          {issue.line ? `:${issue.line}` : ''}
        </div>
      ) : null}

      <p className="mt-2 text-[12px] leading-5 text-secondary">{issue.detail}</p>
      {issue.recommendation ? (
        <p className="mt-2 text-[12px] leading-5 text-muted">{issue.recommendation}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {closed ? (
          <Button variant="ghost" size="sm" loading={busy} onClick={onReopen}>
            Reopen
          </Button>
        ) : (
          <>
            <Button variant="primary" size="sm" loading={busy} onClick={onFix}>
              Fix with agent
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onResolve}>
              Resolve
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onIgnore}>
              Ignore
            </Button>
          </>
        )}
      </div>
    </article>
  )
}

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${className}`}>
      {children}
    </span>
  )
}

function severityClass(severity: ReviewIssue['severity']): string {
  if (severity === 'critical') return 'border-accent-del/50 bg-accent-del/15 text-accent-del'
  if (severity === 'high') return 'border-accent-del/40 bg-accent-del/10 text-accent-del'
  if (severity === 'medium') return 'border-accent-warn/40 bg-accent-warn/10 text-accent-warn'
  return 'border-hairline bg-white/5 text-secondary'
}

function buildFixPrompt(issue: ReviewIssue): string {
  return [
    'Fix this review issue from the Review Inbox.',
    '',
    'Rules:',
    '- Keep the change scoped to this finding.',
    '- Do not revert unrelated user changes.',
    '- Add or update focused tests when the fix changes behavior.',
    '',
    `Severity: ${issue.severity}`,
    `Category: ${issue.category}`,
    `Title: ${issue.title}`,
    issue.filePath ? `File: ${issue.filePath}${issue.line ? `:${issue.line}` : ''}` : null,
    '',
    'Detail:',
    issue.detail,
    '',
    issue.recommendation ? `Recommendation:\n${issue.recommendation}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}
