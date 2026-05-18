import { useState } from 'react'
import { Pill } from '../../../../components/ui'
import { ModelPopover } from './ModelPopover'
import type { ModelGroup, ModelOption, ModelSelection, RoutingDecision } from './types'

interface ModelChipProps {
  groups: ModelGroup[]
  selection: ModelSelection
  manualOption: ModelOption | null
  routerPreview: RoutingDecision | null
  onSelect: (selection: ModelSelection) => void
}

const AGENT_SHORT: Record<string, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
}

/**
 * Composer model chip. Click to open a popover for picking an agent + model.
 * Label format: `{Agent} · {model}` or `Auto` (with router decision hint).
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
    setOpen(false)
  }

  let label: string
  if (manualOption) {
    const agent = AGENT_SHORT[manualOption.agentId] ?? manualOption.agentName
    label = `${agent} · ${manualOption.label}`
  } else if (routerPreview) {
    const agent = AGENT_SHORT[routerPreview.agentId] ?? routerPreview.agentId
    label = `Auto · ${agent} ${routerPreview.model}`
  } else {
    label = 'Auto'
  }

  return (
    <div className="relative min-w-0">
      <Pill
        tone="neutral"
        trailingIcon={<ChevronDownIcon />}
        onClick={() => setOpen((value) => !value)}
        className="max-w-[150px] sm:max-w-[180px]"
      >
        {label}
      </Pill>
      {open ? (
        <ModelPopover
          groups={groups}
          selection={selection}
          onSelect={handleSelect}
          onClose={() => setOpen(false)}
        />
      ) : null}
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
