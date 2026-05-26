function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export interface ChangeBarProps {
  /** Lines added. */
  additions: number
  /** Lines removed. */
  deletions: number
  /** Visual treatment for the surface the bar is rendered on. */
  variant?: 'default' | 'onAccent'
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
export function ChangeBar({
  additions,
  deletions,
  variant = 'default',
  className,
}: ChangeBarProps) {
  const total = additions + deletions
  if (total <= 0) return null

  return (
    <span
      className={cx(
        'inline-flex h-2 w-16 shrink-0 overflow-hidden rounded-full ring-1',
        variant === 'onAccent'
          ? 'bg-diff-track-on-accent ring-white/25'
          : 'bg-diff-track ring-diff-track-border',
        className,
      )}
      aria-hidden="true"
    >
      {additions > 0 ? (
        <span
          className="h-full bg-diff-add-bar"
          style={{
            minWidth: 4,
            width: `${(additions / total) * 100}%`,
            transition: 'width 280ms ease-out',
          }}
        />
      ) : null}
      {deletions > 0 ? (
        <span
          className="h-full bg-diff-del-bar"
          style={{
            minWidth: 4,
            width: `${(deletions / total) * 100}%`,
            transition: 'width 280ms ease-out',
          }}
        />
      ) : null}
    </span>
  )
}
