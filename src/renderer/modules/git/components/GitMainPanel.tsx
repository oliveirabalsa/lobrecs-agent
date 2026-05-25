import { useMemo } from 'react'
import type { GitOperationState, GitRepositorySnapshot } from '../state/gitTuiState'

interface GitMainPanelProps {
  snapshot: GitRepositorySnapshot | null
  loading: boolean
  error: string | null
  operation: GitOperationState
  detail: {
    title: string
    body: string
    kind: string
  }
  onRefresh: () => void
}

export function GitMainPanel({
  snapshot,
  loading,
  error,
  operation,
  detail,
  onRefresh,
}: GitMainPanelProps) {
  const isDiff = detail.kind === 'file' || detail.kind === 'commit' || detail.kind === 'stash'

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border border-hairline bg-black/10">
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-hairline bg-white/[0.025] px-3 font-mono text-[11px] uppercase">
        <div className="min-w-0 truncate text-secondary">
          detail: <span className="text-primary">{detail.title}</span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="no-drag shrink-0 rounded border border-hairline px-2 py-0.5 text-[10px] text-secondary hover:border-white/20 hover:text-primary disabled:opacity-60"
        >
          {loading ? 'loading' : 'R refresh'}
        </button>
      </header>

      <div data-scroll-target="git-diff" className="min-h-0 flex-1 overflow-auto p-3">
        {!snapshot ? (
          <EmptyDetail
            title={error ? 'git unavailable' : 'select a project'}
            body={error ?? 'Choose a repository from the sidebar to open the native GIT interface.'}
          />
        ) : error ? (
          <EmptyDetail title="snapshot failed" body={error} tone="error" />
        ) : isDiff ? (
          <DiffView body={detail.body} />
        ) : (
          <pre className="min-h-full whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-secondary">
            {detail.body}
          </pre>
        )}
      </div>

      <footer className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-hairline px-3 py-2 font-mono text-[11px]">
        <div className="min-w-0 truncate text-muted">
          {operation.message ?? 'ready'}
        </div>
        <div
          className={
            operation.status === 'error'
              ? 'text-accent-del'
              : operation.status === 'success'
                ? 'text-accent-add'
                : operation.status === 'running'
                  ? 'text-accent-primary'
                  : 'text-muted'
          }
        >
          {operation.status}
        </div>
      </footer>
    </section>
  )
}

type DiffLineKind = 'add' | 'del' | 'hunk' | 'meta' | 'context'

function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+++ ') || line.startsWith('--- ')) return 'meta'
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new ') || line.startsWith('deleted ') || line.startsWith('similarity ') || line.startsWith('rename ')) return 'meta'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'context'
}

const DIFF_LINE_STYLES: Record<DiffLineKind, string> = {
  add: 'text-accent-add bg-accent-add/[0.08]',
  del: 'text-accent-del bg-accent-del/[0.08]',
  hunk: 'text-accent-primary/80 bg-accent-primary/[0.05]',
  meta: 'text-yellow-400/80 font-semibold',
  context: 'text-secondary',
}

function DiffView({ body }: { body: string }) {
  const lines = useMemo(() => body.split('\n'), [body])

  return (
    <div className="min-h-full font-mono text-[12px] leading-5">
      {lines.map((line, i) => {
        const kind = classifyDiffLine(line)
        return (
          <div key={i} className={`whitespace-pre-wrap break-words px-1 ${DIFF_LINE_STYLES[kind]}`}>
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}

function EmptyDetail({
  title,
  body,
  tone = 'muted',
}: {
  title: string
  body: string
  tone?: 'muted' | 'error'
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md border border-dashed border-hairline px-4 py-5 text-center font-mono">
        <div className={tone === 'error' ? 'text-accent-del' : 'text-primary'}>{title}</div>
        <p className="mt-2 text-[12px] leading-5 text-muted">{body}</p>
      </div>
    </div>
  )
}
