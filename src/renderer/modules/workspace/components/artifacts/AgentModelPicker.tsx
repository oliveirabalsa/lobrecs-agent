import { useMemo, useState } from 'react'
import type { AgentModel, SupportedAgentId } from '../../../../../shared/types'
import { ModelPopover } from '../Composer/ModelPopover'
import { AGENT_SHORT, formatModelLabel } from '../Composer/modelDisplay'
import type { ModelGroup, ModelSelection } from '../Composer/types'

const AGENT_LABELS: Record<SupportedAgentId, string> = AGENT_SHORT

export function shortAgentModelLabel(
  agentId: SupportedAgentId | undefined,
  modelId: string,
): string {
  if (!agentId) return modelId
  if (agentId === 'claude-code') {
    const match = modelId.match(/^claude-(haiku|sonnet|opus)-(\d+)-(\d+)/i)
    if (match) return `${match[1].charAt(0).toUpperCase()}${match[1].slice(1)} ${match[2]}.${match[3]}`
  }
  if (agentId === 'opencode' && modelId.includes('/')) {
    return modelId.slice(modelId.lastIndexOf('/') + 1).replace(/^MiniMax-/i, 'MiniMax ')
  }
  return modelId
}

export interface AgentModelPickerProps {
  models: AgentModel[]
  selectedModel: AgentModelSelection | null
  onSelect: (selection: AgentModelSelection) => void
}

export interface AgentModelSelection {
  agentId: SupportedAgentId
  modelId: string
}

export function AgentModelPicker({
  models,
  selectedModel,
  onSelect,
}: AgentModelPickerProps) {
  const [open, setOpen] = useState(false)

  const selected = models.find(
    (model) =>
      model.agentId === selectedModel?.agentId && model.id === selectedModel.modelId,
  )
  const selectedAgentId = selected?.agentId ?? selectedModel?.agentId
  const selectedModelId = selected?.id ?? selectedModel?.modelId ?? 'Select model'
  const agentShort = selectedAgentId ? AGENT_SHORT[selectedAgentId] ?? selectedAgentId : 'Agent'
  const label = selectedAgentId
    ? `${agentShort} · ${shortAgentModelLabel(selectedAgentId, selectedModelId)}`
    : 'Select model'

  const modelGroups = useMemo(() => groupModelsByAgent(models), [models])
  const modalSelection = useMemo<ModelSelection>(() => {
    if (selected) {
      return { kind: 'manual', agentId: selected.agentId, modelId: selected.id }
    }
    return { kind: 'auto' }
  }, [selected])

  function handleSelect(selection: ModelSelection) {
    if (selection.kind !== 'manual') return
    onSelect({ agentId: selection.agentId, modelId: selection.modelId })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={modelGroups.length === 0}
        className="flex items-center gap-1.5 rounded-pill border border-hairline bg-card-raised px-2.5 py-1 text-[11px] font-medium text-secondary hover:border-white/20 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="truncate max-w-[180px]">{label}</span>
        <svg
          width="8"
          height="8"
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
      </button>

      <ModelPopover
        open={open}
        groups={modelGroups}
        selection={modalSelection}
        onSelect={handleSelect}
        onClose={() => setOpen(false)}
        allowAuto={false}
        showThinkingControl={false}
      />
    </div>
  )
}

function groupModelsByAgent(models: readonly AgentModel[]): ModelGroup[] {
  const groups = new Map<SupportedAgentId, ModelGroup>()

  for (const model of models) {
    const current =
      groups.get(model.agentId) ??
      {
        agentId: model.agentId,
        label: AGENT_LABELS[model.agentId] ?? model.agentId,
        options: [],
      }

    current.options.push({
      key: `${model.agentId}:${model.id}`,
      agentId: model.agentId,
      agentName: AGENT_LABELS[model.agentId] ?? model.agentId,
      modelId: model.id,
      label: formatModelLabel(model.agentId, model.id),
      tier: model.tier,
    })

    groups.set(model.agentId, current)
  }

  return [...groups.values()]
}
