import { useState } from 'react'
import type { McpToolActivity } from '../../lib/mcpActivity'
import { parseMcpToolName } from '../../lib/mcpActivity'

export interface McpCallCardProps {
  items: McpToolActivity[]
  running?: boolean
}

export function McpCallCard({ items, running = false }: McpCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  if (items.length === 0) return null

  const first = items[0]
  const display = parseMcpToolName(first.name)
  const hasErrors = items.some((item) => item.status === 'error')
  const hasRunning =
    running || items.some((item) => item.kind === 'tool-call' && item.status === 'running')
  const statusClass = hasErrors
    ? 'bg-accent-del'
    : hasRunning
      ? 'bg-accent-primary animate-pulse'
      : 'bg-accent-add'

  return (
    <div
      className={`flex w-full flex-col self-start overflow-hidden rounded-card border ${
        hasErrors ? 'border-accent-del/35' : 'border-hairline'
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={`flex w-full items-center gap-2.5 bg-card-raised px-2.5 py-2 text-xs transition-colors ${
          hasErrors
            ? 'text-accent-del hover:bg-accent-del/[0.06]'
            : 'text-secondary hover:bg-card'
        }`}
        title={first.name}
      >
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent-primary/30 bg-accent-primary/10 text-accent-primary"
          aria-hidden="true"
        >
          {iconMcp}
        </span>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusClass}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">
          <span className="font-medium text-primary">
            {display.server ? `${display.server} MCP` : 'MCP call'}
          </span>
          <span className="ml-2 font-mono text-muted">{display.tool}</span>
        </span>
        <span className="shrink-0 rounded-full bg-card px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted">
          {items.length}
        </span>
        {iconChevron(expanded)}
      </button>

      {expanded ? (
        <div className="motion-expand-down-in divide-y divide-hairline border-t border-hairline">
          {items.map((item, index) => (
            <McpCallRow key={`${item.kind}:${item.name}:${index}`} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function McpCallRow({ item }: { item: McpToolActivity }) {
  const payload = item.kind === 'tool-call' ? item.input : item.output
  const payloadText = formatPayload(payload)

  return (
    <div className="px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted">
          {item.kind === 'tool-call' ? 'call' : 'result'}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-secondary">
          {item.name}
        </span>
        <span
          className={`shrink-0 text-[10px] uppercase ${
            item.status === 'error' ? 'text-accent-del' : 'text-muted'
          }`}
        >
          {item.status}
        </span>
      </div>
      {payloadText ? (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-hairline bg-canvas px-2 py-1.5 font-mono text-[11px] text-secondary">
          {payloadText}
        </pre>
      ) : null}
    </div>
  )
}

function formatPayload(payload: unknown): string | null {
  if (payload === undefined || payload === null) return null
  if (typeof payload === 'string') return payload.trim() || null

  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}

const iconMcp = (
  <svg
    viewBox="0 0 16 16"
    width="12"
    height="12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <path d="M3 5.5 8 2.75l5 2.75v5L8 13.25 3 10.5z" strokeLinejoin="round" />
    <path d="M8 7.75v5.25M3.25 5.75 8 8.25l4.75-2.5" strokeLinejoin="round" />
  </svg>
)

function iconChevron(expanded: boolean) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      style={{
        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 120ms ease-out',
      }}
      aria-hidden="true"
    >
      <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
