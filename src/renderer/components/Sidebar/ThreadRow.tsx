import { Spinner } from '../ui'
import { formatRelative } from '../../lib/relativeTime'
import type { Thread } from './useProjectTree'

interface ThreadRowProps {
  thread: Thread
  active: boolean
  onSelect: (thread: Thread) => void
  onDelete?: (thread: Thread) => void
}

const RUNNING_STATUSES = new Set(['running', 'awaiting-approval'])

export function ThreadRow({ thread, active, onSelect, onDelete }: ThreadRowProps) {
  const isRunning = RUNNING_STATUSES.has(thread.sessionStatus)
  const baseClasses =
    'group flex h-8 w-full items-center gap-1 rounded-card pr-1 pl-3 text-left transition-colors'
  const stateClasses = active
    ? 'bg-white/10 text-primary'
    : 'text-secondary hover:bg-white/5 hover:text-primary'

  return (
    <div
      className={`${baseClasses} ${stateClasses}`}
    >
      <button
        type="button"
        onClick={() => onSelect(thread)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        aria-current={active ? 'page' : undefined}
        title={thread.title}
      >
        <span className="min-w-0 flex-1 truncate text-[13px] leading-none">
          {thread.title}
        </span>
        {isRunning ? (
          <span className="shrink-0 text-secondary" aria-label={`${thread.sessionStatus}`}>
            <Spinner size={12} />
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-muted tabular-nums">
            {formatRelative(thread.updatedAt)}
          </span>
        )}
      </button>
      {onDelete ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onDelete(thread)
          }}
          aria-label={`Delete thread ${thread.title}`}
          title="Delete thread"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted opacity-0 transition hover:bg-accent-del/10 hover:text-accent-del group-hover:opacity-100 focus:opacity-100"
        >
          <TrashIcon />
        </button>
      ) : null}
    </div>
  )
}

function TrashIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  )
}
