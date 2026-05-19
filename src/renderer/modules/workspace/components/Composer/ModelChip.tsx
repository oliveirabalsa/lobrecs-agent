import { useState } from 'react'
import { Pill } from '../../../../components/ui'
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
}

/**
 * Composer model chip. Click to open the picker modal.
 * Label format: `{Agent} · {Friendly Model}` or `Auto` (with router hint).
 * Thinking depth, when active, is appended as `· think:Hi`.
 */
export function ModelChip({
  groups,
  selection,
  manualOption,
  routerPreview,
  onSelect,
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
    label = 'Auto'
  }

  const thinking = selection.thinking && selection.thinking !== 'off' ? selection.thinking : null

  return (
    <div className="relative min-w-0">
      <Pill
        tone="neutral"
        trailingIcon={<ChevronDownIcon />}
        onClick={() => setOpen((value) => !value)}
        className="max-w-[180px] sm:max-w-[220px]"
      >
        <span className="flex items-center gap-1.5">
          <span className="truncate">{label}</span>
          {thinking ? (
            <span
              aria-label={`Thinking ${THINKING_LABEL[thinking]}`}
              title={`Thinking: ${THINKING_LABEL[thinking]}`}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-pill bg-accent-primary/15 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide text-accent-primary"
            >
              <BrainIcon />
              {THINKING_LABEL[thinking].slice(0, 2)}
            </span>
          ) : null}
        </span>
      </Pill>
      <ModelPopover
        open={open}
        groups={groups}
        selection={selection}
        onSelect={handleSelect}
        onClose={() => setOpen(false)}
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
