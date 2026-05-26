import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  Project,
  ReviewIssue,
  ReviewIssuePatch,
  ReviewIssueProvider,
  ReviewIssueStatus,
} from '../../../../shared/types'
import { Button } from '../../../components/ui'
import type { StartedSessionSummary } from '../../sessions/types'

interface ReviewInboxPanelProps {
  project: Project
  activeThreadId?: string | null
  onSessionStarted?: (session: StartedSessionSummary) => void
}

type StatusFilter = 'active' | 'all'

export function ReviewInboxPanel({
  project,
  activeThreadId,
  onSessionStarted,
}: ReviewInboxPanelProps) {
  const [rawIssues, setRawIssues] = useState<ReviewIssue[]>([])
  const [counts, setCounts] = useState({ open: 0, fixing: 0, resolved: 0, ignored: 0 })
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [providerFilter, setProviderFilter] = useState<ReviewIssueProvider | 'all'>('all')
  const [roundFilter, setRoundFilter] = useState<number | 'all'>('all')
  const [loading, setLoading] = useState(false)
  const [fetchingGithub, setFetchingGithub] = useState(false)
  const [reviewingPr, setReviewingPr] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyIssueId, setBusyIssueId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [gitState, setGitState] = useState<{ branch: string; fingerprint: string } | null>(null)

  const activeCount = counts.open + counts.fixing

  const loadIssues = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await window.agentforge.reviews.list({
        projectId: project.id,
        status: 'all',
      })
      setRawIssues(next.issues)
      setCounts(next.counts)
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load review issues.')
    } finally {
      setLoading(false)
    }
  }, [project.id])

  const loadGitState = useCallback(async () => {
    try {
      const state = await window.agentforge.git.getFingerprint(project.id)
      setGitState(state)
    } catch {
      // Ignore git errors silently
    }
  }, [project.id])

  useEffect(() => {
    void loadIssues()
    void loadGitState()
  }, [loadIssues, loadGitState])

  const handleRefresh = async () => {
    setSelectedIds(new Set())
    await Promise.all([loadIssues(), loadGitState()])
  }

  // Derive unique round numbers and providers dynamically from all raw issues
  const availableRounds = useMemo(() => {
    const rounds = new Set<number>()
    for (const issue of rawIssues) {
      if (typeof issue.roundNumber === 'number') {
        rounds.add(issue.roundNumber)
      }
    }
    return Array.from(rounds).sort((a, b) => b - a)
  }, [rawIssues])

  const availableProviders = useMemo(() => {
    const providers = new Set<ReviewIssueProvider>()
    for (const issue of rawIssues) {
      if (issue.provider) {
        providers.add(issue.provider)
      }
    }
    return Array.from(providers)
  }, [rawIssues])

  // Filter raw issues in React
  const visibleIssues = useMemo(() => {
    return rawIssues.filter((issue) => {
      // Status filter
      if (statusFilter === 'active') {
        if (issue.status !== 'open' && issue.status !== 'fixing') return false
      }
      // Provider filter
      if (providerFilter !== 'all' && issue.provider !== providerFilter) return false
      // Round filter
      if (roundFilter !== 'all' && issue.roundNumber !== roundFilter) return false

      return true
    })
  }, [rawIssues, statusFilter, providerFilter, roundFilter])

  // Checkbox functions
  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setSelectedIds(next)
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === visibleIssues.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(visibleIssues.map((i) => i.id)))
    }
  }

  // GitHub review comment import
  const importGithubReviews = async () => {
    setFetchingGithub(true)
    setError(null)
    try {
      await window.agentforge.reviews.fetch(project.id, 'github')
      await loadIssues()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to import GitHub reviews.')
    } finally {
      setFetchingGithub(false)
    }
  }

  // PR-native AI review (runs the local analyzer over a remote PR diff)
  const reviewPullRequest = async () => {
    const raw = window.prompt('GitHub pull request number to review:')
    if (!raw) return

    const prNumber = Number.parseInt(raw.trim(), 10)
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      setError('Enter a positive integer pull request number.')
      return
    }

    setReviewingPr(true)
    setError(null)
    try {
      await window.agentforge.git.reviewPr({
        projectId: project.id,
        prNumber,
        threadId: activeThreadId ?? undefined,
      })
      await loadIssues()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to review pull request.')
    } finally {
      setReviewingPr(false)
    }
  }

  // Single issue actions
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

  // Batch actions
  async function handleBatchFix() {
    if (selectedIds.size === 0) return
    setLoading(true)
    setError(null)
    try {
      const issueIds = Array.from(selectedIds)
      const result = await window.agentforge.reviews.fixBatch(
        project.id,
        issueIds,
        activeThreadId ?? undefined,
      )

      onSessionStarted?.({
        sessionId: result.sessionId,
        threadId: result.threadId,
        prompt: `Fix batch of ${issueIds.length} review issues`,
        routingDecision: null,
        createdAt: Date.now(),
      })
      setSelectedIds(new Set())
      await loadIssues()
    } catch (fixError: unknown) {
      setError(fixError instanceof Error ? fixError.message : 'Failed to start batch fix session.')
    } finally {
      setLoading(false)
    }
  }

  async function handleBatchStatusUpdate(status: 'resolved' | 'ignored') {
    if (selectedIds.size === 0) return
    setLoading(true)
    setError(null)
    try {
      const issueIds = Array.from(selectedIds)
      await Promise.all(issueIds.map((id) => window.agentforge.reviews.update(id, { status })))
      setSelectedIds(new Set())
      await loadIssues()
    } catch (updateError: unknown) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update batch issues.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      {/* Header */}
      <div className="shrink-0 border-b border-hairline px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-primary">Review Inbox</h2>
            <div className="mt-0.5 text-[11px] text-muted">
              {activeCount} active · {counts.resolved} resolved
            </div>
          </div>
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <Button
              variant="primary"
              size="sm"
              loading={reviewingPr}
              onClick={() => void reviewPullRequest()}
              className="h-7 shrink-0 whitespace-nowrap bg-gradient-to-r from-accent-primary to-accent-secondary text-[11px]"
              title="Run the local diff reviewer against a remote pull request"
            >
              Review PR
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={fetchingGithub}
              onClick={() => void importGithubReviews()}
              className="h-7 shrink-0 whitespace-nowrap text-[11px]"
              title="Import existing PR comments from GitHub"
            >
              Import GitHub
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={loading}
              onClick={() => void handleRefresh()}
              className="h-7 shrink-0 whitespace-nowrap text-[11px]"
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-hairline/40 pt-3">
          <div className="flex items-center gap-1">
            <FilterButton active={statusFilter === 'active'} onClick={() => setStatusFilter('active')}>
              Active
            </FilterButton>
            <FilterButton active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
              All
            </FilterButton>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Provider Filter */}
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value as any)}
              className="rounded border border-hairline bg-card-raised px-1.5 py-0.5 text-[11px] text-muted hover:text-primary focus:outline-none focus:border-accent-primary"
            >
              <option value="all">All Providers</option>
              {availableProviders.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            {/* Round Filter */}
            <select
              value={roundFilter}
              onChange={(e) => setRoundFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="rounded border border-hairline bg-card-raised px-1.5 py-0.5 text-[11px] text-muted hover:text-primary focus:outline-none focus:border-accent-primary"
            >
              <option value="all">All Rounds</option>
              {availableRounds.map((r) => (
                <option key={r} value={r}>
                  Round {r}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error ? (
        <div className="shrink-0 border-b border-accent-del/40 bg-accent-del/10 px-3 py-2 text-xs text-accent-del">
          {error}
        </div>
      ) : null}

      {/* Batch Selection Action Bar */}
      {selectedIds.size > 0 ? (
        <div className="shrink-0 bg-accent-primary/10 border-b border-accent-primary/30 px-4 py-2 flex items-center justify-between gap-3 animate-fade-in">
          <span className="text-[11px] font-semibold text-accent-primary">
            {selectedIds.size} {selectedIds.size === 1 ? 'issue' : 'issues'} selected
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleBatchFix()}
              className="text-[11px] h-6 bg-accent-primary hover:bg-accent-primary-hover"
            >
              Fix batch
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleBatchStatusUpdate('resolved')}
              className="text-[11px] h-6"
            >
              Resolve
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleBatchStatusUpdate('ignored')}
              className="text-[11px] h-6"
            >
              Ignore
            </Button>
          </div>
        </div>
      ) : null}

      {/* Issues list container */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {visibleIssues.length > 0 ? (
          <div className="flex flex-col gap-2">
            {/* Toggle Select All check */}
            <div className="flex items-center gap-2 px-1 py-1 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={visibleIssues.length > 0 && selectedIds.size === visibleIssues.length}
                onChange={toggleSelectAll}
                className="h-3.5 w-3.5 rounded border-hairline bg-card cursor-pointer focus:ring-0"
              />
              <span className="cursor-pointer select-none" onClick={toggleSelectAll}>
                Select All ({visibleIssues.length})
              </span>
            </div>

            {visibleIssues.map((issue) => {
              const isStale =
                issue.provider === 'local-diff-review' &&
                !!issue.fingerprint &&
                !!gitState?.fingerprint &&
                issue.fingerprint !== gitState.fingerprint

              return (
                <ReviewIssueCard
                  key={issue.id}
                  issue={issue}
                  busy={busyIssueId === issue.id}
                  isSelected={selectedIds.has(issue.id)}
                  isStale={isStale}
                  onToggleSelect={() => toggleSelect(issue.id)}
                  onFix={() => void fixIssue(issue)}
                  onResolve={() => void updateIssue(issue, { status: 'resolved' })}
                  onIgnore={() => void updateIssue(issue, { status: 'ignored' })}
                  onReopen={() => void updateIssue(issue, { status: 'open', fixSessionId: null })}
                />
              )
            })}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-[12px] leading-5 text-muted">
            {loading
              ? 'Loading review issues...'
              : 'No review issues match the selected filters.'}
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
      className={`rounded px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
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
  isSelected,
  isStale,
  onToggleSelect,
  onFix,
  onResolve,
  onIgnore,
  onReopen,
}: {
  issue: ReviewIssue
  busy: boolean
  isSelected: boolean
  isStale: boolean
  onToggleSelect: () => void
  onFix: () => void
  onResolve: () => void
  onIgnore: () => void
  onReopen: () => void
}) {
  const closed = issue.status === 'resolved' || issue.status === 'ignored'

  return (
    <article className="group rounded-card border border-hairline bg-card/60 px-3 py-3 hover:bg-card/90 transition-all duration-150">
      <div className="flex items-start gap-3">
        {/* Selection Checkbox */}
        <div className="pt-0.5 shrink-0">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="h-3.5 w-3.5 rounded border-hairline bg-card cursor-pointer focus:ring-0 text-accent-primary"
          />
        </div>

        {/* Card Body */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={severityClass(issue.severity)}>{issue.severity}</Badge>
            <Badge className="border-hairline bg-card-raised text-muted">{issue.category}</Badge>
            <Badge className={providerBadgeClass(issue.provider)}>
              {providerBadgeLabel(issue.provider)}
            </Badge>
            {issue.roundNumber ? (
              <Badge className="border-hairline bg-accent-primary/10 text-accent-primary border-accent-primary/20">
                Round {issue.roundNumber}
              </Badge>
            ) : null}
            {issue.providerRef ? (
              issue.sourceUrl ? (
                <a
                  href={issue.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase border border-hairline bg-accent-secondary/10 text-accent-secondary hover:border-accent-secondary/40"
                  title={issue.sourceUrl}
                >
                  PR #{issue.providerRef}
                </a>
              ) : (
                <Badge className="border-hairline bg-accent-secondary/10 text-accent-secondary border-accent-secondary/20">
                  PR #{issue.providerRef}
                </Badge>
              )
            ) : null}
            {isStale ? (
              <Badge className="border-accent-warn/30 bg-accent-warn/10 text-accent-warn lowercase animate-pulse">
                stale diff
              </Badge>
            ) : null}
          </div>

          <h3 className="mt-2 text-[13px] font-semibold leading-5 text-primary">
            {issue.title}
          </h3>

          {issue.filePath ? (
            <div className="mt-1.5 truncate font-mono text-[10px] text-muted">
              {issue.filePath}
              {issue.line ? `:${issue.line}` : ''}
            </div>
          ) : null}

          <p className="mt-2 text-[12px] leading-5 text-secondary whitespace-pre-wrap">{issue.detail}</p>
          {issue.recommendation ? (
            <p className="mt-2 text-[12px] leading-5 text-muted italic border-l-2 border-hairline pl-2 bg-white/5 py-1 rounded-r">
              {issue.recommendation}
            </p>
          ) : null}

          {/* Warning text for stale diffs */}
          {isStale ? (
            <p className="mt-2 text-[10px] font-medium text-accent-warn">
              ⚠️ Warning: Git working tree has changed since this review was run. Apply with caution.
            </p>
          ) : null}

          {/* Action Row */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {closed ? (
              <Button variant="ghost" size="sm" loading={busy} onClick={onReopen} className="h-6 text-[10px] px-2">
                Reopen
              </Button>
            ) : (
              <>
                <Button variant="primary" size="sm" loading={busy} onClick={onFix} className="h-6 text-[10px] px-2 bg-gradient-to-r from-accent-primary/80 to-accent-secondary/80">
                  Fix with agent
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={onResolve} className="h-6 text-[10px] px-2">
                  Resolve
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={onIgnore} className="h-6 text-[10px] px-2">
                  Ignore
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${className}`}>
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

function providerBadgeClass(provider: ReviewIssueProvider): string {
  if (provider === 'github') {
    return 'border-accent-secondary/40 bg-accent-secondary/10 text-accent-secondary'
  }
  if (provider === 'local-diff-review' || provider === 'local-review') {
    return 'border-hairline bg-card-raised text-muted'
  }
  return 'border-hairline bg-card-raised text-muted'
}

function providerBadgeLabel(provider: ReviewIssueProvider): string {
  if (provider === 'github') return 'GitHub'
  if (provider === 'local-diff-review') return 'Local'
  if (provider === 'local-review') return 'Local'
  if (provider === 'coderabbit') return 'CodeRabbit'
  if (provider.startsWith('extension:')) return provider.slice('extension:'.length) || 'Extension'
  return provider
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
