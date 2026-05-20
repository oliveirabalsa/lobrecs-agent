function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export interface ChangeBarProps {
  /** Lines added. */
  additions: number
  /** Lines removed. */
  deletions: number
  /**
   * Extra classes for the outer track — e.g. responsive visibility or
   * margins. The track's size, shape, and background are fixed here.
   */
  className?: string
}

/**
 * ChangeBar — a miniature dual-colored bar graph showing the ratio of
 * additions (green) to deletions (red) within a file change. The two segments
 * are sized proportionally to the total lines touched, giving an instantly
 * scannable sense of "how big, and which direction" a change is.
 *
 * Renders nothing when there is nothing to show, so callers can drop it in
 * unconditionally next to their numeric +N/-M labels.
 */
export function ChangeBar({ additions, deletions, className }: ChangeBarProps) {
  const total = additions + deletions
  if (total <= 0) return null

  return (
    <span
      className={cx(
        'inline-flex h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-white/10',
        className,
      )}
      aria-hidden="true"
    >
      {additions > 0 ? (
        <span
          className="h-full bg-accent-add"
          style={{ width: `${(additions / total) * 100}%` }}
        />
      ) : null}
      {deletions > 0 ? (
        <span
          className="h-full bg-accent-del"
          style={{ width: `${(deletions / total) * 100}%` }}
        />
      ) : null}
    </span>
  )
}
