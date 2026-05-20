import { useState } from 'react'
import type { AgentActivity } from '../../../../../shared/types'
import { Pill, Spinner } from '../../../../components/ui'
import { CommandCard } from './CommandCard'

export type RanCommandItem = Extract<
  AgentActivity,
  { kind: 'command' | 'tool-call' | 'tool-result' }
>

export interface RanCommandsPillProps {
  items: RanCommandItem[]
  running?: boolean
}

export interface RanCommandsState {
  active: boolean
  count: number
  failed: boolean
}

type RanCommandStatus = 'pending' | 'running' | 'done' | 'error'

export interface RanCommandRow {
  id: string
  label: string
  title: string
  status: RanCommandStatus
  output?: string
}

interface MutableRanCommandRow extends RanCommandRow {
  matchKey: string
  toolName?: string
}

/**
 * RanCommandsPill — collapsible chip that aggregates a batch of consecutive
 * tool/command activities into a single Codex-style pill.
 *
 *   "Ran 3 commands"  (closed) → click → list of commands with stdout snippets
 *   "Running 3 commands…" only while at least one row is still unresolved.
 */
export function RanCommandsPill({ items, running = false }: RanCommandsPillProps) {
  const [expanded, setExpanded] = useState(false)
  const rows = deriveRanCommandRows(items)
  const state = deriveRanCommandsState(items, running)
  const count = state.count
  const label = state.active
    ? `Running ${count} command${count === 1 ? '' : 's'}…`
    : `Ran ${count} command${count === 1 ? '' : 's'}`

  return (
    <div className="flex w-full flex-col gap-2 self-start">
      <Pill
        tone={state.failed ? 'warn' : 'neutral'}
        leadingIcon={iconTerminal}
        trailingIcon={state.active ? <Spinner size={12} /> : iconChevron(expanded)}
        onClick={() => setExpanded((v) => !v)}
        className="max-w-full"
      >
        {label}
      </Pill>

      {expanded ? (
        <div className="motion-expand-down-in flex flex-col gap-1.5 rounded-card border border-hairline bg-canvas/60 p-2">
          {rows.map((row) => (
            <CommandCard key={row.id} row={row} running={state.active} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function deriveRanCommandsState(
  items: RanCommandItem[],
  sessionRunning: boolean,
): RanCommandsState {
  const rows = deriveRanCommandRows(items)

  return {
    active: sessionRunning && rows.some((row) => isUnresolvedStatus(row.status)),
    count: rows.length,
    failed: rows.some((row) => row.status === 'error'),
  }
}

export function deriveRanCommandRows(items: RanCommandItem[]): RanCommandRow[] {
  const rows: MutableRanCommandRow[] = []

  for (const item of items) {
    if (item.kind === 'command') {
      upsertCommandRow(rows, item)
      continue
    }

    if (item.kind === 'tool-call') {
      upsertToolCallRow(rows, item)
      continue
    }

    upsertToolResultRow(rows, item)
  }

  return rows.map(({ matchKey: _matchKey, toolName: _toolName, ...row }) => row)
}

function upsertCommandRow(
  rows: MutableRanCommandRow[],
  item: Extract<RanCommandItem, { kind: 'command' }>,
): void {
  const matchKey = `command:${item.command}`
  const existing = findLastActiveRow(rows, (row) => row.matchKey === matchKey)
  if (existing) {
    existing.status = mergeStatus(existing.status, item.status)
    return
  }

  rows.push({
    id: `${matchKey}:${rows.length}`,
    label: '$',
    title: item.command,
    status: item.status,
    matchKey,
  })
}

function upsertToolCallRow(
  rows: MutableRanCommandRow[],
  item: Extract<RanCommandItem, { kind: 'tool-call' }>,
): void {
  const matchKey = `tool-call:${item.name}:${inputSignature(item.input)}`
  const existing = findLastActiveRow(rows, (row) => row.matchKey === matchKey)
  if (existing) {
    existing.status = mergeStatus(existing.status, item.status)
    return
  }

  rows.push({
    id: `${matchKey}:${rows.length}`,
    label: 'call',
    title: displayToolCall(item),
    status: item.status,
    matchKey,
    toolName: item.name,
  })
}

function upsertToolResultRow(
  rows: MutableRanCommandRow[],
  item: Extract<RanCommandItem, { kind: 'tool-result' }>,
): void {
  const existing = findLastRow(
    rows,
    (row) => row.toolName === item.name && row.output === undefined,
  )
  if (existing) {
    existing.status = mergeStatus(existing.status, item.status)
    existing.output = item.output
    return
  }

  rows.push({
    id: `tool-result:${item.name}:${rows.length}`,
    label: 'result',
    title: item.name,
    status: item.status,
    output: item.output,
    matchKey: `tool-result:${item.name}:${rows.length}`,
    toolName: item.name,
  })
}

function findLastActiveRow(
  rows: MutableRanCommandRow[],
  predicate: (row: MutableRanCommandRow) => boolean,
): MutableRanCommandRow | undefined {
  return findLastRow(rows, (row) => isUnresolvedStatus(row.status) && predicate(row))
}

function findLastRow(
  rows: MutableRanCommandRow[],
  predicate: (row: MutableRanCommandRow) => boolean,
): MutableRanCommandRow | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (predicate(row)) return row
  }
  return undefined
}

function mergeStatus(previous: RanCommandStatus, next: RanCommandStatus): RanCommandStatus {
  if (previous === 'error' || next === 'error') return 'error'
  return next
}

function isUnresolvedStatus(status: RanCommandStatus): boolean {
  return status === 'running' || status === 'pending'
}

function displayToolCall(item: Extract<RanCommandItem, { kind: 'tool-call' }>): string {
  if (typeof item.input === 'string') {
    const trimmed = item.input.trim()
    return trimmed ? `${item.name} ${trimmed}` : item.name
  }
  return item.name
}

function inputSignature(input: unknown): string {
  return formatInput(input) || 'no-input'
}

function formatInput(input: unknown): string | undefined {
  if (typeof input === 'string') return input.trim() || undefined
  if (input === undefined || input === null) return undefined

  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

const iconTerminal = (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
    <path d="m4.5 6.5 2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 11h3.5" strokeLinecap="round" />
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
    >
      <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
