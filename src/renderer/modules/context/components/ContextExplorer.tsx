import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  Project,
  RepositoryContextChunk,
  RepositoryContextIndexResult,
  RepositoryContextStatus,
} from '../../../../shared/types'
import { Button, Spinner } from '../../../components/ui'
import {
  clampContextScore,
  getContextIndexState,
  type ContextIndexState,
} from '../domain/contextExplorerState'

interface ContextExplorerProps {
  project: Project
  onEditProjectContext?: () => void
}

type StatusState =
  | { kind: 'loading' }
  | { kind: 'ready'; status: RepositoryContextStatus; lastIndexResult?: RepositoryContextIndexResult }
  | { kind: 'error'; message: string }

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; query: string; results: RepositoryContextChunk[] }
  | { kind: 'error'; query: string; message: string }

export function ContextExplorer({ project, onEditProjectContext }: ContextExplorerProps) {
  const [statusState, setStatusState] = useState<StatusState>({ kind: 'loading' })
  const [searchState, setSearchState] = useState<SearchState>({ kind: 'idle' })
  const [query, setQuery] = useState('')
  const [indexing, setIndexing] = useState(false)

  const loadStatus = useCallback(async () => {
    setStatusState({ kind: 'loading' })
    try {
      const status = await window.agentforge.context.status(project.id)
      setStatusState({ kind: 'ready', status })
    } catch (error: unknown) {
      setStatusState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to load context status.',
      })
    }
  }, [project.id])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const indexState = useMemo<ContextIndexState | null>(() => {
    if (statusState.kind !== 'ready') return null
    return getContextIndexState(statusState.status)
  }, [statusState])

  const handleReindex = useCallback(async () => {
    if (indexing) return
    setIndexing(true)
    setStatusState((current) => (current.kind === 'ready' ? current : { kind: 'loading' }))
    try {
      const result = await window.agentforge.context.index(project.id)
      setStatusState({
        kind: 'ready',
        status: {
          projectId: result.projectId,
          indexedChunks: result.indexedChunks,
          indexedFiles: result.indexedFiles,
          updatedAt: result.updatedAt,
        },
        lastIndexResult: result,
      })
    } catch (error: unknown) {
      setStatusState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to rebuild context index.',
      })
    } finally {
      setIndexing(false)
    }
  }, [indexing, project.id])

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim()
    if (!trimmed) {
      setSearchState({ kind: 'idle' })
      return
    }

    setSearchState({ kind: 'loading' })
    try {
      const results = await window.agentforge.context.search({
        projectId: project.id,
        query: trimmed,
        limit: 8,
      })
      setSearchState({ kind: 'ready', query: trimmed, results })
      const status = await window.agentforge.context.status(project.id)
      setStatusState({ kind: 'ready', status })
    } catch (error: unknown) {
      setSearchState({
        kind: 'error',
        query: trimmed,
        message: error instanceof Error ? error.message : 'Failed to search context index.',
      })
    }
  }, [project.id, query])

  return (
    <section className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="shrink-0 border-b border-hairline px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-primary">Context explorer</h2>
            <p className="mt-1 text-[11px] leading-5 text-muted">
              Retrieval evidence for {project.name}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="chip"
            onClick={() => void handleReindex()}
            loading={indexing}
          >
            Reindex
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-3">
          <StatusCard
            state={statusState}
            indexState={indexState}
            indexing={indexing}
            onRetry={() => void loadStatus()}
            onReindex={() => void handleReindex()}
          />

          <form
            className="rounded-card border border-hairline bg-card p-3"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSearch()
            }}
          >
            <label
              htmlFor="context-search"
              className="text-[11px] font-medium uppercase text-muted"
            >
              Search snippets
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="context-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search files, symbols, decisions..."
                className="h-8 min-w-0 flex-1 rounded-card border border-hairline bg-card-raised px-2.5 text-[12px] text-primary outline-none placeholder:text-muted focus:border-white/20"
              />
              <Button
                type="submit"
                size="sm"
                variant="primary"
                loading={searchState.kind === 'loading'}
                disabled={!query.trim()}
              >
                Search
              </Button>
            </div>
          </form>

          <SearchResults state={searchState} />

          <ProjectNotesCard project={project} onEdit={onEditProjectContext} />
        </div>
      </div>
    </section>
  )
}

function StatusCard({
  state,
  indexState,
  indexing,
  onRetry,
  onReindex,
}: {
  state: StatusState
  indexState: ContextIndexState | null
  indexing: boolean
  onRetry: () => void
  onReindex: () => void
}) {
  if (state.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-card border border-hairline bg-card p-3 text-[12px] text-muted">
        <Spinner size={12} />
        Loading context index...
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="rounded-card border border-accent-del/40 bg-accent-del/10 p-3">
        <div className="text-[12px] font-medium text-accent-del">Context unavailable</div>
        <p className="mt-1 text-[12px] leading-5 text-accent-del/90">{state.message}</p>
        <Button type="button" size="sm" variant="chip" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      </div>
    )
  }

  const updatedLabel = state.status.updatedAt
    ? new Date(state.status.updatedAt).toLocaleString()
    : 'Never'

  return (
    <div className="rounded-card border border-hairline bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium text-primary">Index status</div>
          <div className="mt-1 text-[11px] text-muted">{updatedLabel}</div>
        </div>
        <IndexBadge state={indexState} indexing={indexing} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Files" value={state.status.indexedFiles} />
        <Metric label="Chunks" value={state.status.indexedChunks} />
        {state.lastIndexResult ? (
          <Metric label="Skipped" value={state.lastIndexResult.skippedFiles} />
        ) : null}
      </div>

      {indexState === 'empty' ? (
        <Callout
          title="No index yet"
          body="Build the context index before searching snippets."
          actionLabel="Index now"
          onAction={onReindex}
        />
      ) : null}

      {indexState === 'stale' ? (
        <Callout
          title="Index may be stale"
          body="The repository has not been indexed recently. Reindex before trusting retrieval evidence."
          actionLabel="Reindex"
          onAction={onReindex}
        />
      ) : null}
    </div>
  )
}

function SearchResults({ state }: { state: SearchState }) {
  if (state.kind === 'idle') {
    return (
      <div className="rounded-card border border-dashed border-hairline bg-card/60 px-3 py-6 text-center text-[12px] leading-5 text-muted">
        Search the repository index to inspect the snippets an agent could retrieve.
      </div>
    )
  }

  if (state.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-card border border-hairline bg-card p-3 text-[12px] text-muted">
        <Spinner size={12} />
        Searching context...
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="rounded-card border border-accent-del/40 bg-accent-del/10 p-3">
        <div className="text-[12px] font-medium text-accent-del">Search failed</div>
        <p className="mt-1 text-[12px] leading-5 text-accent-del/90">{state.message}</p>
      </div>
    )
  }

  if (state.results.length === 0) {
    return (
      <div className="rounded-card border border-hairline bg-card px-3 py-6 text-center">
        <div className="text-[12px] font-medium text-primary">No results</div>
        <p className="mt-1 text-[12px] leading-5 text-muted">
          No indexed snippets matched "{state.query}".
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium uppercase text-muted">
        Top snippets for "{state.query}"
      </div>
      {state.results.map((result) => (
        <SnippetCard key={`${result.path}:${result.startLine}-${result.endLine}`} result={result} />
      ))}
    </div>
  )
}

function SnippetCard({ result }: { result: RepositoryContextChunk }) {
  return (
    <article className="rounded-card border border-hairline bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-primary" title={result.path}>
            {result.path}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            Lines {result.startLine}-{result.endLine}
          </div>
        </div>
        <span className="shrink-0 rounded-pill border border-hairline bg-card-raised px-2 py-0.5 text-[11px] text-secondary">
          {clampContextScore(result.score)}%
        </span>
      </div>
      <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-card border border-hairline/70 bg-canvas p-3 font-mono text-[11px] leading-5 text-secondary">
        {result.content}
      </pre>
    </article>
  )
}

function ProjectNotesCard({
  project,
  onEdit,
}: {
  project: Project
  onEdit?: () => void
}) {
  return (
    <div className="rounded-card border border-hairline bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium text-primary">Project notes</div>
          <div className="mt-1 text-[11px] text-muted">
            Static instructions sent alongside retrieved snippets.
          </div>
        </div>
        {onEdit ? (
          <Button type="button" size="sm" variant="chip" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
      </div>
      <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-[12px] leading-5 text-secondary">
        {project.context?.trim() || 'No project notes saved.'}
      </p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-hairline/70 bg-card-raised px-3 py-2">
      <div className="text-[16px] font-semibold text-primary">{value.toLocaleString()}</div>
      <div className="mt-0.5 text-[11px] text-muted">{label}</div>
    </div>
  )
}

function IndexBadge({
  state,
  indexing,
}: {
  state: ContextIndexState | null
  indexing: boolean
}) {
  if (indexing) {
    return (
      <span className="rounded-pill border border-hairline bg-card-raised px-2 py-0.5 text-[11px] text-secondary">
        Indexing
      </span>
    )
  }

  const label = state === 'fresh' ? 'Fresh' : state === 'stale' ? 'Stale' : 'Empty'
  const classes =
    state === 'fresh'
      ? 'border-accent-add/40 bg-accent-add/10 text-accent-add'
      : state === 'stale'
        ? 'border-accent-warn/40 bg-accent-warn/10 text-accent-warn'
        : 'border-hairline bg-card-raised text-muted'

  return (
    <span className={`rounded-pill border px-2 py-0.5 text-[11px] ${classes}`}>
      {label}
    </span>
  )
}

function Callout({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string
  body: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className="mt-3 rounded-card border border-hairline bg-card-raised p-3">
      <div className="text-[12px] font-medium text-primary">{title}</div>
      <p className="mt-1 text-[12px] leading-5 text-muted">{body}</p>
      <Button type="button" size="sm" variant="chip" className="mt-3" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  )
}
