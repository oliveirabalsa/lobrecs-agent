import type { MouseEvent } from 'react'
import type { SessionStatus } from '../../../shared/types'
import { Spinner } from '../ui'
import type { Thread } from './useProjectTree'

interface ThreadRowProps {
  thread: Thread
  active: boolean
  onSelect: (thread: Thread) => void
  onSelectAgent?: (thread: Thread, sessionId: string) => void
  onDelete?: (thread: Thread) => void
}

const RUNNING_STATUSES = new Set(['running', 'awaiting-approval', 'awaiting-input'])

interface StatusDotStyle {
  /** Tailwind background-color class for the dot. */
  color: string
  /** Render an expanding "ping" halo — used for live / needs-attention states. */
  active: boolean
  /** Accessible + tooltip label. */
  label: string
}

// Exhaustive over SessionStatus: a new status won't compile until it's mapped.
const STATUS_DOT: Record<SessionStatus, StatusDotStyle> = {
  running: { color: 'bg-accent-primary', active: true, label: 'Running' },
  'awaiting-approval': { color: 'bg-accent-warn', active: true, label: 'Awaiting approval' },
  'awaiting-input': { color: 'bg-accent-warn', active: true, label: 'Waiting for your answer' },
  done: { color: 'bg-accent-add', active: false, label: 'Done' },
  error: { color: 'bg-accent-del', active: false, label: 'Failed' },
  cancelled: { color: 'bg-muted', active: false, label: 'Cancelled' },
}

export function ThreadRow({ thread, active, onSelect, onSelectAgent, onDelete }: ThreadRowProps) {
  void onSelectAgent
  const isRunning = RUNNING_STATUSES.has(thread.sessionStatus)
  const baseClasses =
    'group flex h-7 w-full cursor-pointer items-center gap-1 rounded-card pr-1 pl-2 text-left transition-colors'
  const stateClasses = active
    ? 'bg-white/10 text-primary'
    : 'text-secondary hover:bg-white/5 hover:text-primary'
  const inactiveButtonClass = 'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition hover:bg-accent-del/10 hover:text-accent-del'

  function handleDeleteClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    onDelete?.(thread)
  }

  return (
    <div className="min-w-0">
      <div
        className={`relative ${baseClasses} ${stateClasses}`}
      >
        {active ? (
          <span
            className="animate-accent-line absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-pill bg-accent-primary shadow-[0_0_8px_var(--color-accent-primary)]"
            aria-hidden="true"
          />
        ) : null}
        <button
          type="button"
          onClick={() => onSelect(thread)}
          className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
          aria-current={active ? 'page' : undefined}
          aria-label={thread.title}
        >
          <StatusDot status={thread.sessionStatus} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] leading-none">
            {thread.title}
          </span>
          {isRunning ? (
            <span className="shrink-0 text-secondary" aria-label={`${thread.sessionStatus}`}>
              <Spinner size={12} />
            </span>
          ) : null}
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={handleDeleteClick}
            aria-label={`Delete thread ${thread.title}`}
            title="Delete thread"
            className={`${inactiveButtonClass} opacity-0 group-hover:opacity-100 focus:opacity-100`}
          >
            <TrashIcon />
          </button>
        ) : null}
      </div>

    </div>
  )
}

/**
 * Color-coded session-status circle. Active states (`running`, `awaiting-*`)
 * get an expanding `animate-ping` halo so threads needing attention stand out
 * when scanning the sidebar; terminal states show a calm solid dot.
 */
function StatusDot({ status }: { status: SessionStatus }) {
  const style = STATUS_DOT[status] ?? STATUS_DOT.cancelled
  return (
    <span
      className="relative flex h-2 w-2 shrink-0 items-center justify-center"
      role="img"
      aria-label={`Session status: ${style.label}`}
      title={style.label}
    >
      {style.active ? (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${style.color}`}
          aria-hidden="true"
        />
      ) : null}
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${style.color}`}
        aria-hidden="true"
      />
    </span>
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
