import { useEffect, useRef, useState } from 'react'
import type { AgentModel, SupportedAgentId } from '../../../../../shared/types'

const AGENT_SHORT: Partial<Record<SupportedAgentId, string>> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  antigravity: 'Antigravity',
}

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
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onDocKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onDocKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onDocKey)
    }
  }, [open])

  const selected = models.find(
    (model) =>
      model.agentId === selectedModel?.agentId && model.id === selectedModel.modelId,
  )
  const selectedAgentId = selected?.agentId ?? selectedModel?.agentId
  const selectedModelId = selected?.id ?? selectedModel?.modelId ?? 'Select model'
  const agentShort = selectedAgentId ? AGENT_SHORT[selectedAgentId] ?? selectedAgentId : 'Agent'
  const label = `${agentShort} · ${shortAgentModelLabel(selectedAgentId, selectedModelId)}`

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-pill border border-hairline bg-card-raised px-2.5 py-1 text-[11px] font-medium text-secondary hover:border-white/20 hover:text-primary"
      >
        <span className="truncate max-w-[180px]">{label}</span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Execution model"
          className="absolute bottom-8 left-0 z-50 min-w-[200px] overflow-hidden rounded-card border border-hairline bg-card-raised py-1 shadow-xl shadow-black/40"
        >
          {models.map((model) => {
            const isActive =
              model.agentId === selectedModel?.agentId && model.id === selectedModel.modelId
            return (
              <button
                key={`${model.agentId}:${model.id}`}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  onSelect({ agentId: model.agentId, modelId: model.id })
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                  isActive ? 'bg-white/5 text-primary' : 'text-secondary hover:bg-white/5 hover:text-primary'
                }`}
              >
                <span className="flex-1 truncate">
                  {AGENT_SHORT[model.agentId] ?? model.agentId} · {shortAgentModelLabel(model.agentId, model.id)}
                </span>
                {isActive ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
