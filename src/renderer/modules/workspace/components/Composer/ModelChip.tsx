import { useState } from 'react'
import { ModelPopover } from './ModelPopover'
import {
  AGENT_SHORT,
  THINKING_LABEL,
  formatModelLabel,
} from './modelDisplay'
import type { ModelGroup, ModelOption, ModelSelection, RoutingDecision } from './types'

interface ModelChipProps {
  groups: ModelGroup[]
  selection: ModelSelection
  manualOption: ModelOption | null
  routerPreview: RoutingDecision | null
  onSelect: (selection: ModelSelection) => void
  allowAuto?: boolean
}

/**
 * Composer model chip. Click to open the compact picker popover.
 * Label format: `{Agent} · {Friendly Model}` or `Auto` (with router hint).
 * Thinking depth, when active, is appended as `· think:Hi`.
 */
export function ModelChip({
  groups,
  selection,
  manualOption,
  routerPreview,
  onSelect,
  allowAuto = true,
}: ModelChipProps) {
  const [open, setOpen] = useState(false)

  function handleSelect(next: ModelSelection) {
    onSelect(next)
  }

  let label: string
  if (manualOption) {
    const agent = AGENT_SHORT[manualOption.agentId] ?? manualOption.agentName
    label = `${agent} · ${manualOption.label}`
  } else if (routerPreview) {
    const agent = AGENT_SHORT[routerPreview.agentId] ?? routerPreview.agentId
    const model = formatModelLabel(routerPreview.agentId, routerPreview.model)
    label = `Auto · ${agent} ${model}`
  } else {
    label = allowAuto ? 'Auto' : 'Select model'
  }

  const thinking = selection.thinking && selection.thinking !== 'off' ? selection.thinking : null

  return (
    <div className="relative min-w-0 shrink-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Select model: ${label}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setOpen((value) => !value)}
        className="group flex max-w-[220px] items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-white/5 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40 sm:max-w-[280px]"
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate">{label}</span>
          {thinking ? (
            <span
              aria-label={`Thinking ${THINKING_LABEL[thinking]}`}
              title={`Thinking: ${THINKING_LABEL[thinking]}`}
              className="inline-flex shrink-0 items-center gap-0.5 rounded bg-accent-primary/15 px-1 py-0 text-[9px] font-semibold uppercase text-accent-primary"
            >
              <BrainIcon />
              {THINKING_LABEL[thinking].slice(0, 2)}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-muted transition-colors group-hover:text-primary">
          <ChevronDownIcon />
        </span>
      </button>
      <ModelPopover
        open={open}
        groups={groups}
        selection={selection}
        onSelect={handleSelect}
        onClose={() => setOpen(false)}
        allowAuto={allowAuto}
      />
    </div>
  )
}

function ChevronDownIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function BrainIcon() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  )
}
