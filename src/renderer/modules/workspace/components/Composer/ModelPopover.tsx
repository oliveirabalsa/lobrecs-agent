import { useEffect, useRef } from 'react'
import type { ModelGroup, ModelSelection, ModelTier } from './types'

interface ModelPopoverProps {
  groups: ModelGroup[]
  selection: ModelSelection
  onSelect: (selection: ModelSelection) => void
  onClose: () => void
}

const TIER_LABEL: Record<ModelTier, string> = {
  lightweight: 'Lightweight',
  balanced: 'Balanced',
  advanced: 'Advanced',
  frontier: 'Frontier',
}

const TIER_TONE: Record<ModelTier, string> = {
  lightweight: 'bg-accent-add/10 text-accent-add border-accent-add/30',
  balanced: 'bg-accent-primary/10 text-accent-primary border-accent-primary/30',
  advanced: 'bg-accent-warn/10 text-accent-warn border-accent-warn/30',
  frontier: 'bg-accent-del/10 text-accent-del border-accent-del/30',
}

/**
 * Popover surfacing every installed agent's models, grouped by agent, with
 * an "Auto routing" option at the top. Closes on outside-click + ESC.
 */
export function ModelPopover({ groups, selection, onSelect, onClose }: ModelPopoverProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onDocMouseDown(event: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) onClose()
    }
    function onDocKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onDocKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onDocKey)
    }
  }, [onClose])

  const autoActive = selection.kind === 'auto'

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Select model"
      className="absolute bottom-9 right-0 z-50 max-h-[360px] w-72 overflow-y-auto rounded-card border border-hairline bg-card-raised py-1 shadow-xl shadow-black/40"
    >
      <button
        type="button"
        role="option"
        aria-selected={autoActive}
        onClick={() => onSelect({ kind: 'auto' })}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
          autoActive
            ? 'bg-white/5 text-primary'
            : 'text-secondary hover:bg-white/5 hover:text-primary'
        }`}
      >
        <span className="flex-1">
          <span className="font-medium">Auto routing</span>
          <span className="ml-1 text-muted">— router picks the best agent</span>
        </span>
        {autoActive ? <span className="text-accent-primary">●</span> : null}
      </button>

      {groups.map((group) => (
        <div key={group.agentId} className="border-t border-hairline pt-1">
          <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted">
            {group.label}
          </div>
          {group.options.map((option) => {
            const isActive =
              selection.kind === 'manual' &&
              selection.agentId === option.agentId &&
              selection.modelId === option.modelId
            return (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() =>
                  onSelect({
                    kind: 'manual',
                    agentId: option.agentId,
                    modelId: option.modelId,
                  })
                }
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                  isActive
                    ? 'bg-white/5 text-primary'
                    : 'text-secondary hover:bg-white/5 hover:text-primary'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <span
                  className={`inline-flex h-4 items-center rounded-pill border px-1.5 text-[9px] font-medium ${
                    TIER_TONE[option.tier]
                  }`}
                >
                  {TIER_LABEL[option.tier]}
                </span>
                {isActive ? <span className="text-accent-primary">●</span> : null}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
