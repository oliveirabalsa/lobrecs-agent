export type FileChangeType = 'added' | 'modified' | 'deleted'

export interface FileChangeRowProps {
  filePath: string
  changeType: FileChangeType
  additions?: number
  deletions?: number
  onClick?: (filePath: string) => void
}

/**
 * FileChangeRow — single row for an isolated `file-change` activity.
 *
 * Icon by change type: + (added), ✎ (modified), − (deleted). Path is
 * truncated from the left so the filename stays visible. Click is handled
 * by the parent (typically opens the right diff panel).
 */
export function FileChangeRow({
  filePath,
  changeType,
  additions,
  deletions,
  onClick,
}: FileChangeRowProps) {
  const handleClick = onClick ? () => onClick(filePath) : undefined
  const interactive = Boolean(handleClick)

  const content = (
    <>
      <span className={`shrink-0 font-mono text-xs ${iconColor(changeType)}`} aria-hidden="true">
        {iconChar(changeType)}
      </span>
      <span
        className="min-w-0 flex-1 truncate font-mono text-xs text-secondary"
        dir="rtl"
        title={filePath}
      >
        {filePath}
      </span>
      <span className="shrink-0 font-mono text-xs">
        {typeof additions === 'number' ? (
          <span className="text-accent-add">+{additions}</span>
        ) : null}
        {typeof additions === 'number' && typeof deletions === 'number' ? (
          <span className="mx-1 text-muted"> </span>
        ) : null}
        {typeof deletions === 'number' ? (
          <span className="text-accent-del">-{deletions}</span>
        ) : null}
      </span>
    </>
  )

  if (interactive) {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="flex w-full items-center gap-2 self-start rounded-card border border-hairline bg-card px-3 py-1.5 text-left transition-colors hover:bg-card-raised"
      >
        {content}
      </button>
    )
  }

  return (
    <div className="flex w-full items-center gap-2 self-start rounded-card border border-hairline bg-card px-3 py-1.5">
      {content}
    </div>
  )
}

function iconChar(type: FileChangeType): string {
  switch (type) {
    case 'added':
      return '+'
    case 'deleted':
      return '−'
    case 'modified':
    default:
      return '✎'
  }
}

function iconColor(type: FileChangeType): string {
  switch (type) {
    case 'added':
      return 'text-accent-add'
    case 'deleted':
      return 'text-accent-del'
    case 'modified':
    default:
      return 'text-secondary'
  }
}
