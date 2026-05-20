import { useState } from 'react'
import { Spinner } from '../../../../components/ui'
import { CommandCard } from './CommandCard'
import {
  deriveRanCommandRows,
  deriveRanCommandsState,
  type RanCommandItem,
} from './RanCommandsPill'
import {
  getCommandTypeGroup,
  type CommandType,
} from '../../lib/commandClassifier'

export interface CommandsGroupProps {
  type: CommandType
  items: RanCommandItem[]
  running?: boolean
}

export interface CommandsGroupDisplayState {
  count: number
  hasErrors: boolean
  hasRunning: boolean
  label: string
}

export function deriveCommandsGroupDisplayState(
  type: CommandType,
  items: RanCommandItem[],
  running = false,
): CommandsGroupDisplayState {
  const groupLabel = getCommandTypeGroup(type)
  const state = deriveRanCommandsState(items, running)
  const label = state.active
    ? `${groupLabel} (${state.count}…)`
    : `${groupLabel} (${state.count})`

  return {
    count: state.count,
    hasErrors: state.failed,
    hasRunning: state.active,
    label,
  }
}

export function CommandsGroup({
  type,
  items,
  running = false,
}: CommandsGroupProps) {
  const [collapsed, setCollapsed] = useState(true)
  const { count, hasErrors, hasRunning } = deriveCommandsGroupDisplayState(
    type,
    items,
    running,
  )
  const groupLabel = getCommandTypeGroup(type)
  const rows = deriveRanCommandRows(items)

  return (
    <div
      className={`flex w-full flex-col self-start overflow-hidden rounded-card border transition-colors ${
        hasErrors ? 'border-accent-del/35' : 'border-hairline'
      }`}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className={`flex w-full items-center gap-2.5 bg-card-raised px-2.5 py-2 text-xs font-medium transition-colors ${
          hasErrors
            ? 'text-accent-del hover:bg-accent-del/[0.06]'
            : 'text-secondary hover:bg-card'
        }`}
        title={`${count} ${groupLabel.toLowerCase()}`}
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-hairline bg-card ${
            hasErrors ? 'text-accent-del' : 'text-secondary'
          }`}
          aria-hidden="true"
        >
          {getGroupIcon(type)}
        </span>
        <span className="flex-1 truncate text-left text-primary">
          {groupLabel}
        </span>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
            hasErrors
              ? 'bg-accent-del/15 text-accent-del'
              : 'bg-card text-muted'
          }`}
        >
          {count}
        </span>
        {hasRunning ? <Spinner size={12} /> : iconChevron(collapsed)}
      </button>

      {!collapsed ? (
        <div className="motion-expand-down-in flex flex-col gap-1.5 border-t border-hairline bg-canvas/60 p-2">
          {rows.map((row) => (
            <CommandCard key={row.id} row={row} running={hasRunning} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function getGroupIcon(type: CommandType) {
  const icons: Record<CommandType, React.ReactNode> = {
    shell: (
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
    'file-ops': (
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
    other: (
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="8" cy="8" r="6.25" />
        <path d="M8 5v6M5 8h6" strokeLinecap="round" />
      </svg>
    ),
  }
  return icons[type]
}

function iconChevron(collapsed: boolean) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      style={{
        transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
        transition: 'transform 120ms ease-out',
      }}
    >
      <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
