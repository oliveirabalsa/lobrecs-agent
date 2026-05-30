interface StatusFooterProps {
  /** Optional worktree branch label. When absent shows "Local". */
  worktreeBranch?: string | null
  /** Percentage 0–100 (or null if unknown). */
  contextPercent: number | null
  hasProjectContext?: boolean
  onContextClick?: () => void
}

/**
 * 22px Cursor-style accent row below the composer card. Left shows a worktree
 * label when available; right opens the repository context explorer.
 */
export function StatusFooter({
  worktreeBranch,
  contextPercent,
  hasProjectContext = false,
  onContextClick,
}: StatusFooterProps) {
  const locationLabel = worktreeBranch ? `Worktree: ${worktreeBranch}` : 'Local'
  const contextLabel =
    contextPercent === null ? 'Context' : `${Math.max(0, Math.min(100, Math.round(contextPercent)))}%`

  return (
    <div className="flex h-[22px] min-w-0 items-center justify-between gap-3 px-3 text-[11px] text-muted">
      <span className="inline-flex min-w-0 items-center gap-1">
        <span className="shrink-0" aria-hidden="true">⊡</span>
        <span className="truncate">{locationLabel}</span>
      </span>
      <button
        type="button"
        onClick={onContextClick}
        disabled={!onContextClick}
        className="focus-ring inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-white/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
        aria-label="Open context explorer"
        title="Open context explorer"
      >
        <span aria-hidden="true">{hasProjectContext ? '●' : '○'}</span>
        <span>{contextLabel}</span>
      </button>
    </div>
  )
}
