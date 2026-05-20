import { useState } from 'react'
import { Spinner } from '../../../../components/ui'
import { CommandCard } from './CommandCard'
import type { RanCommandItem } from './RanCommandsPill'
import {
  classifyCommand,
  getCommandTypeGroup,
  type CommandType,
} from '../../lib/commandClassifier'

export interface CommandsGroupProps {
  type: CommandType
  items: RanCommandItem[]
  running?: boolean
}

export function CommandsGroup({
  type,
  items,
  running = false,
}: CommandsGroupProps) {
  const [collapsed, setCollapsed] = useState(true)
  const count = items.length
  const groupLabel = getCommandTypeGroup(type)
  const hasErrors = items.some((item) => item.status === 'error')
  const hasRunning = running && items.some((item) => item.status !== 'done' && item.status !== 'error')

  const label = hasRunning
    ? `${groupLabel} (${count}…)`
    : `${groupLabel} (${count})`

  return (
    <div className="flex w-full flex-col gap-2 self-start">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className={`inline-flex max-w-full items-center gap-2 self-start rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors ${
          hasErrors
            ? 'border-accent-del bg-accent-del/5 text-accent-del hover:bg-accent-del/10'
            : 'border-hairline bg-card-raised hover:bg-card'
        }`}
        title={`${count} ${groupLabel.toLowerCase()}`}
      >
        <span className="text-secondary">{getGroupIcon(type)}</span>
        <span>{label}</span>
        {hasRunning ? <Spinner size={12} /> : iconChevron(collapsed)}
      </button>

      {!collapsed ? (
        <div className="flex flex-col gap-2 pl-2">
          {items.map((item, idx) => (
            <CommandCard
              key={`${type}-${idx}`}
              item={item}
              running={running}
            />
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
