import { useState } from 'react'
import { Spinner } from '../../../../components/ui'
import type { RanCommandItem } from './RanCommandsPill'
import {
  classifyCommand,
  type CommandMeta,
} from '../../lib/commandClassifier'
import { formatCommandDisplay } from '../../lib/commandFormatters'

export interface CommandCardProps {
  item: RanCommandItem
  meta?: CommandMeta
  running?: boolean
}

export function CommandCard({ item, meta, running = false }: CommandCardProps) {
  const [expanded, setExpanded] = useState(meta?.showOutputByDefault ?? false)
  const classMeta = meta || classifyCommand(item)

  const display = formatCommandDisplay(item)
  const status = item.status
  const output = item.kind === 'tool-result' ? item.output : undefined

  const showOutput = output && output.trim()
  const hasContent = expanded || showOutput

  const dotClass = getDotClass(status, running)
  const statusText = getStatusText(status, running)

  return (
    <div className="flex w-full flex-col gap-1.5 self-start">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`inline-flex max-w-full items-center gap-2 self-start rounded-card border px-3 py-2 text-xs transition-colors ${
          expanded
            ? 'bg-card border-hairline'
            : 'border-hairline bg-card-raised hover:bg-card'
        }`}
        title={display.title}
      >
        <span className="shrink-0 text-secondary" aria-hidden="true">
          {getIcon(classMeta.icon)}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-secondary text-left">
          {display.title}
          {display.details ? (
            <span className="ml-1 text-muted">{display.details}</span>
          ) : null}
        </span>
        <span
          className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}
          aria-hidden="true"
        />
        {running && status !== 'done' && status !== 'error' && !showOutput ? (
          <Spinner size={12} />
        ) : null}
      </button>

      {hasContent ? (
        <div className="rounded-card border border-hairline bg-card px-3 py-2 text-xs text-secondary">
          {expanded && !showOutput ? (
            <div className="font-mono text-[11px] text-muted">{display.title}</div>
          ) : null}
          {showOutput ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-hairline bg-canvas px-2 py-1.5 font-mono text-[10px] text-secondary">
              {truncate(output, 500)}
            </pre>
          ) : null}
          {statusText ? (
            <div className="mt-1 text-[10px] text-muted">{statusText}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}


function getDotClass(
  status: 'pending' | 'running' | 'done' | 'error',
  running: boolean,
): string {
  if (status === 'error') return 'bg-accent-del'
  if (status === 'running' || (running && status === 'pending'))
    return 'bg-accent-primary'
  if (status === 'pending') return 'bg-text-muted'
  return 'bg-accent-add'
}

function getStatusText(
  status: 'pending' | 'running' | 'done' | 'error',
  running: boolean,
): string | undefined {
  if (status === 'error') return 'Error'
  if (status === 'running') return 'Running…'
  if (status === 'pending' && running) return 'Pending…'
  return undefined
}

function getIcon(type: string) {
  const iconMap: Record<string, React.ReactNode> = {
    terminal: (
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
        <path d="m4.5 6.5 2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 11h3.5" strokeLinecap="round" />
      </svg>
    ),
    package: (
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M8 1 L13.5 3.5 L13.5 8 L8 11 L2.5 8 L2.5 3.5 Z" />
        <path d="M8 11 L8 15" strokeLinecap="round" />
      </svg>
    ),
    git: (
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="6" cy="4" r="1.5" />
        <circle cx="12" cy="9" r="1.5" />
        <circle cx="6" cy="13" r="1.5" />
        <path d="M7 4.5 L11 8.5" strokeLinecap="round" />
        <path d="M6.5 5 L6.5 11.5" strokeLinecap="round" />
      </svg>
    ),
    file: (
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M3 2 L3 14 L13 14 L13 5.5 L9.5 2 Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.5 2 L9.5 5 L13 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    tool: (
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M13.5 3.5 L3.5 13.5 M3.5 3.5 L13.5 13.5" strokeLinecap="round" />
      </svg>
    ),
  }
  return iconMap[type] || iconMap.terminal
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}
