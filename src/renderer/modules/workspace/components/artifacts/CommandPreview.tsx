import { useState } from 'react'

export interface CommandPreviewProps {
  command: string
  cwd?: string
  output?: string
  status?: 'pending' | 'running' | 'done' | 'error'
}

/**
 * CommandPreview — single-line monospace command pill used when a single
 * `command` activity appears outside of a multi-command batch.
 *
 * Clicking expands a small card with the full command, cwd, and output.
 */
export function CommandPreview({
  command,
  cwd,
  output,
  status = 'done',
}: CommandPreviewProps) {
  const [expanded, setExpanded] = useState(false)
  const dotClass =
    status === 'running'
      ? 'bg-accent-primary animate-pulse'
      : status === 'error'
        ? 'bg-accent-del'
        : status === 'pending'
          ? 'bg-text-muted'
          : 'bg-accent-add'

  return (
    <div className="flex w-full flex-col gap-1.5 self-start">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex max-w-full items-center gap-2 self-start rounded-pill border border-hairline bg-card-raised px-2.5 py-1 text-xs text-secondary transition-colors hover:bg-white/5"
        title={command}
      >
        <span className="inline-flex shrink-0 text-secondary" aria-hidden="true">
          {iconTerminal}
        </span>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
        <span className="min-w-0 truncate font-mono text-secondary">{command}</span>
      </button>

      {expanded ? (
        <div className="rounded-card border border-hairline bg-card px-3 py-2 text-xs text-secondary">
          <div className="font-mono whitespace-pre-wrap break-all text-primary">{command}</div>
          {cwd ? (
            <div className="mt-1 font-mono text-muted">cwd: {cwd}</div>
          ) : null}
          {output ? (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-hairline bg-canvas px-2 py-1.5 font-mono text-[11px] text-secondary">
              {output}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const iconTerminal = (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
    <path d="m4.5 6.5 2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 11h3.5" strokeLinecap="round" />
  </svg>
)
