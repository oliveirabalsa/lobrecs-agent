interface StatusFooterProps {
  /** Optional worktree branch label. When absent shows "Local". */
  worktreeBranch?: string | null
  /** Percentage 0–100 (or null if unknown). */
  contextPercent: number | null
}

/**
 * 22px Cursor-style accent row below the composer card. Left shows the
 * working location (`⊡ Local` or `Worktree: <branch>`); right shows the
 * context usage indicator.
 */
export function StatusFooter({ worktreeBranch, contextPercent }: StatusFooterProps) {
  // TODO: derive worktree branch from active session metadata once exposed.
  const locationLabel = worktreeBranch ? `Worktree: ${worktreeBranch}` : 'Local'
  const contextLabel =
    contextPercent === null ? '— context' : `${Math.max(0, Math.min(100, Math.round(contextPercent)))}% context`

  return (
    <div className="flex h-[22px] min-w-0 items-center justify-between gap-3 px-3 text-[11px] text-muted">
      <span className="inline-flex min-w-0 items-center gap-1">
        <span className="shrink-0" aria-hidden="true">⊡</span>
        <span className="truncate">{locationLabel}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1">
        <span aria-hidden="true">○</span>
        <span>{contextLabel}</span>
      </span>
    </div>
  )
}
