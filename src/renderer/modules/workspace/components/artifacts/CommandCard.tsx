import { useState } from 'react'
import type { ReactNode } from 'react'
import { Spinner } from '../../../../components/ui'
import type { RanCommandRow } from './RanCommandsPill'
import {
  classifyShellCommand,
  classifyToolCall,
  prettifyToolName,
  type CommandMeta,
} from '../../lib/commandClassifier'

export interface CommandCardProps {
  row: RanCommandRow
  running?: boolean
  /** Row mode: no outer card border; rendered as a list item inside CommandsGroup. */
  compact?: boolean
}

type RanCommandStatus = RanCommandRow['status']

interface CommandDisplay {
  meta: CommandMeta
  /** Optional namespace badge (e.g. the MCP server). */
  namespace?: string
  /** Bold leading token — the command/tool name. */
  primary: string
  /** Dimmed trailing text — arguments or sub-path. */
  secondary?: string
}

/**
 * CommandCard — one command/tool invocation.
 *
 * compact=false (default): standalone card with border, used in RanCommandsPill.
 * compact=true: borderless list row used inside CommandsGroup; the group's
 * outer card provides the container so each row needs no extra nesting.
 */
export function CommandCard({ row, running = false, compact = false }: CommandCardProps) {
  const display = describeRow(row)
  const [expanded, setExpanded] = useState(display.meta.showOutputByDefault)

  const output = row.output && row.output.trim() ? row.output : undefined
  const hasOutput = Boolean(output)
  const isOpen = hasOutput && expanded

  const status = row.status
  const unresolved = status === 'running' || status === 'pending'
  const showSpinner = running && unresolved && !hasOutput
  const failed = status === 'error'

  if (compact) {
    return (
      <div className="flex w-full flex-col">
        <button
          type="button"
          onClick={hasOutput ? () => setExpanded((v) => !v) : undefined}
          disabled={!hasOutput}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
            hasOutput ? 'cursor-pointer hover:bg-card/60' : 'cursor-default'
          } ${failed ? 'text-accent-del' : ''}`}
          title={
            display.secondary
              ? `${display.primary} ${display.secondary}`
              : display.primary
          }
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-secondary" aria-hidden="true">
            {getIcon(display.meta.icon)}
          </span>

          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            {display.namespace ? (
              <span className="shrink-0 rounded bg-canvas px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                {display.namespace}
              </span>
            ) : null}
            <span className="shrink-0 font-mono text-[11px] text-primary">
              {display.primary}
            </span>
            {display.secondary ? (
              <span className="min-w-0 truncate font-mono text-[10px] text-muted">
                {display.secondary}
              </span>
            ) : null}
          </span>

          {showSpinner ? (
            <Spinner size={12} />
          ) : (
            <StatusIndicator status={status} running={running} />
          )}

          {hasOutput ? <Chevron open={isOpen} /> : null}
        </button>

        {isOpen && output ? (
          <div className="motion-expand-down-in ml-8 mr-3 mb-1.5 rounded border-l-2 border-hairline bg-canvas/70 px-2.5 py-1.5">
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-[1.55] text-secondary">
              {truncate(output, 2000)}
            </pre>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={`flex w-full flex-col self-start overflow-hidden rounded-card border transition-colors ${
        failed
          ? 'border-accent-del/35 bg-accent-del/[0.04]'
          : 'border-hairline bg-card-raised'
      }`}
    >
      <button
        type="button"
        onClick={hasOutput ? () => setExpanded((v) => !v) : undefined}
        disabled={!hasOutput}
        className={`flex w-full items-center gap-2.5 px-2.5 py-2 text-left ${
          hasOutput ? 'cursor-pointer hover:bg-card' : 'cursor-default'
        }`}
        title={
          display.secondary
            ? `${display.primary} ${display.secondary}`
            : display.primary
        }
      >
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-hairline bg-card text-secondary"
          aria-hidden="true"
        >
          {getIcon(display.meta.icon)}
        </span>

        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          {display.namespace ? (
            <span className="shrink-0 rounded bg-card px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
              {display.namespace}
            </span>
          ) : null}
          <span className="shrink-0 font-mono text-[12px] text-primary">
            {display.primary}
          </span>
          {display.secondary ? (
            <span className="min-w-0 truncate font-mono text-[11px] text-muted">
              {display.secondary}
            </span>
          ) : null}
        </span>

        {showSpinner ? (
          <Spinner size={12} />
        ) : (
          <StatusIndicator status={status} running={running} />
        )}

        {hasOutput ? <Chevron open={isOpen} /> : null}
      </button>

      {isOpen && output ? (
        <div className="motion-expand-down-in border-t border-hairline bg-canvas px-3 py-2">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-[1.55] text-secondary">
            {truncate(output, 2000)}
          </pre>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Split a derived row into its display parts. Shell commands split on the
 * first space (`npm` + `run build`); tool calls run through `prettifyToolName`
 * so MCP identifiers surface a namespace badge instead of a wall of `__`.
 */
function describeRow(row: RanCommandRow): CommandDisplay {
  const firstSpace = row.title.indexOf(' ')
  const head = firstSpace === -1 ? row.title : row.title.slice(0, firstSpace)
  const tail =
    firstSpace === -1 ? undefined : row.title.slice(firstSpace + 1).trim()

  if (row.label === '$') {
    return {
      meta: classifyShellCommand(row.title),
      primary: head,
      secondary: tail || undefined,
    }
  }

  const pretty = prettifyToolName(head)
  return {
    meta: classifyToolCall(head),
    namespace: pretty.namespace,
    primary: pretty.name,
    secondary: tail || undefined,
  }
}

function StatusIndicator({
  status,
  running,
}: {
  status: RanCommandStatus
  running: boolean
}) {
  if (status === 'error') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-accent-del">
        <svg
          viewBox="0 0 16 16"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3.5" strokeLinecap="round" />
          <circle cx="8" cy="11" r="0.6" fill="currentColor" stroke="none" />
        </svg>
        Failed
      </span>
    )
  }

  if (status === 'done') {
    return (
      <svg
        className="shrink-0 text-accent-add"
        viewBox="0 0 16 16"
        width="13"
        height="13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-label="done"
      >
        <path d="m3.5 8.5 3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  // running / pending — a quiet dot, tinted live only while the session runs.
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
        running && status === 'running'
          ? 'animate-pulse bg-accent-primary'
          : 'bg-text-muted'
      }`}
      aria-hidden="true"
    />
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className="shrink-0 text-muted"
      style={{
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 140ms ease-out',
      }}
      aria-hidden="true"
    >
      <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function getIcon(type: CommandMeta['icon']): ReactNode {
  const iconMap: Record<CommandMeta['icon'], ReactNode> = {
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
        <path
          d="M3 2 L3 14 L13 14 L13 5.5 L9.5 2 Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M9.5 2 L9.5 5 L13 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    mcp: (
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M6.5 9.5 L9.5 6.5" strokeLinecap="round" />
        <path
          d="M7.5 4.5 L9 3 a2.8 2.8 0 0 1 4 4 L11.5 8.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8.5 11.5 L7 13 a2.8 2.8 0 0 1-4-4 L4.5 7.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
        <path
          d="M10.5 2.5a3 3 0 0 0-4 4l-4 4 2 2 4-4a3 3 0 0 0 4-4l-2 2-2-2Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  }
  return iconMap[type] ?? iconMap.terminal
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}
