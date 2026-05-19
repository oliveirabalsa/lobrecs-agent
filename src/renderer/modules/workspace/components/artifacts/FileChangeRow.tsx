export type FileChangeType = 'added' | 'modified' | 'deleted'

export interface FileChangeRowProps {
  filePath: string
  changeType: FileChangeType
  additions?: number
  deletions?: number
  onClick?: (filePath: string) => void
}

export function FileChangeRow({
  filePath,
  changeType,
  additions,
  deletions,
  onClick,
}: FileChangeRowProps) {
  const stats = (
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
  )

  if (onClick) {
    return (
      <div className="group flex w-full items-center self-start rounded-card border border-hairline bg-card px-3 py-1.5">
        <button
          type="button"
          onClick={() => onClick(filePath)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:bg-card-raised"
        >
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
        </button>
        {stats}
        <button
          type="button"
          onClick={() => void window.agentforge.system.openInEditor(filePath)}
          className="ml-2 shrink-0 rounded p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary"
          title="Open in editor"
        >
          {iconExternalLink}
        </button>
      </div>
    )
  }

  return (
    <div className="group flex w-full items-center gap-2 self-start rounded-card border border-hairline bg-card px-3 py-1.5">
      <span className={`shrink-0 font-mono text-xs ${iconColor(changeType)}`} aria-hidden="true">
        {iconChar(changeType)}
      </span>
      <button
        type="button"
        onClick={() => void window.agentforge.system.openInEditor(filePath)}
        className="min-w-0 flex-1 truncate text-left font-mono text-xs text-secondary transition-colors hover:text-primary"
        dir="rtl"
        title={filePath}
      >
        {filePath}
      </button>
      {stats}
    </div>
  )
}

const iconExternalLink = (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M6.5 3.5H3a1 1 0 0 0-1 1v8.5a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V10" strokeLinecap="round" />
    <path d="M9.5 2.5h4v4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13.5 2.5 8 8" strokeLinecap="round" />
  </svg>
)

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
