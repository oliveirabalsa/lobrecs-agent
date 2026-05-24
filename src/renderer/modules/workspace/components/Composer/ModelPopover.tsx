import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../../../components/ui'
import {
  AGENT_SHORT,
  THINKING_LABEL,
  TIER_LABEL,
  TIER_TONE,
  supportsThinking,
} from './modelDisplay'
import type { ModelGroup, ModelOption, ModelSelection, ThinkingLevel } from './types'

const AUTO_THINKING_LEVELS: Array<Exclude<ThinkingLevel, 'off'>> = [
  'low',
  'medium',
  'high',
  'xhigh',
]

interface ModelPickerModalProps {
  open: boolean
  groups: ModelGroup[]
  selection: ModelSelection
  onSelect: (selection: ModelSelection) => void
  onClose: () => void
  allowAuto?: boolean
  showThinkingControl?: boolean
}

/**
 * Two-pane model picker: provider tabs on the left, model cards on the right
 * with a thinking-depth segmented control for tiers that support it.
 *
 * "Auto routing" is treated as its own provider in the left column.
 */
export function ModelPopover({
  open,
  groups,
  selection,
  onSelect,
  onClose,
  allowAuto = true,
  showThinkingControl = true,
}: ModelPickerModalProps) {
  const tabs = useMemo(() => {
    const providerTabs = groups.map((g) => ({
      id: g.agentId,
      label: AGENT_SHORT[g.agentId] ?? g.label,
    }))
    return allowAuto
      ? [{ id: 'auto' as const, label: 'Auto' }, ...providerTabs]
      : providerTabs
  }, [allowAuto, groups])

  const initialTab = useMemo(() => {
    if (selection.kind === 'manual') return selection.agentId
    return tabs[0]?.id ?? 'auto'
  }, [selection, tabs])

  const [activeTab, setActiveTab] = useState<typeof tabs[number]['id']>(initialTab)

  useEffect(() => {
    if (open) setActiveTab(initialTab)
  }, [open, initialTab])

  const thinking: ThinkingLevel = selection.thinking ?? 'off'
  const activeGroup = groups.find((g) => g.agentId === activeTab) ?? null

  function pickAuto() {
    onSelect({ kind: 'auto', thinking: thinking === 'off' ? undefined : thinking })
    onClose()
  }

  function pickModel(option: ModelOption) {
    const nextThinking = thinkingForOption(option, thinking)
    const next: ModelSelection = nextThinking
      ? { kind: 'manual', agentId: option.agentId, modelId: option.modelId, thinking: nextThinking }
      : { kind: 'manual', agentId: option.agentId, modelId: option.modelId }
    onSelect(next)
    onClose()
  }

  function setThinking(next: ThinkingLevel) {
    if (selection.kind === 'manual') {
      onSelect({
        kind: 'manual',
        agentId: selection.agentId,
        modelId: selection.modelId,
        thinking: next === 'off' ? undefined : next,
      })
    } else {
      onSelect({ kind: 'auto', thinking: next === 'off' ? undefined : next })
    }
  }

  const autoActive = selection.kind === 'auto'
  const selectedOption =
    selection.kind === 'manual'
      ? groups
          .find((g) => g.agentId === selection.agentId)
          ?.options.find((o) => o.modelId === selection.modelId) ?? null
      : null
  const showThinking =
    showThinkingControl &&
    (autoActive ? true : selectedOption ? supportsThinking(selectedOption) : false)
  const visibleThinkingLevels = ['off' as const, ...thinkingLevelsForSelection(selectedOption, autoActive)]
  const selectedThinking = visibleThinkingLevels.includes(thinking) ? thinking : 'off'

  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? null : onClose())}
      title="Select model"
      visualTitle={false}
      description="Choose an agent, model, and thinking depth"
      maxWidth={640}
    >
      <div className="flex min-h-[360px] gap-3">
        <nav
          aria-label="Provider"
          className="flex w-32 shrink-0 flex-col gap-0.5 border-r border-hairline pr-2"
        >
          {tabs.map((tab) => {
            const active = tab.id === activeTab
            const tabSelected =
              tab.id === 'auto'
                ? selection.kind === 'auto'
                : selection.kind === 'manual' && selection.agentId === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center justify-between gap-1 rounded-card px-2.5 py-1.5 text-left text-xs transition-colors ${
                  active
                    ? 'bg-white/10 text-primary'
                    : 'text-secondary hover:bg-white/5 hover:text-primary'
                }`}
              >
                <span className="truncate">{tab.label}</span>
                {tabSelected ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary" />
                ) : null}
              </button>
            )
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto pr-1">
            {activeTab === 'auto' ? (
              <button
                type="button"
                onClick={pickAuto}
                className={`flex w-full flex-col gap-1 rounded-card border px-3 py-3 text-left transition-colors ${
                  autoActive
                    ? 'border-accent-primary/40 bg-accent-primary/5'
                    : 'border-hairline hover:border-white/15 hover:bg-white/5'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-primary">Auto routing</span>
                  {autoActive ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-primary" />
                  ) : null}
                </div>
                <span className="text-xs text-muted">
                  Router scores complexity and picks the best agent + model per turn.
                </span>
              </button>
            ) : (
              <div className="flex flex-col gap-1">
                {activeGroup?.options.map((option) => {
                  const isActive =
                    selection.kind === 'manual' &&
                    selection.agentId === option.agentId &&
                    selection.modelId === option.modelId
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => pickModel(option)}
                      className={`flex w-full items-center justify-between gap-2 rounded-card border px-3 py-2 text-left transition-colors ${
                        isActive
                          ? 'border-accent-primary/40 bg-accent-primary/5'
                          : 'border-transparent hover:border-white/10 hover:bg-white/5'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-primary">
                        {option.label}
                      </span>
                      <span
                        className={`inline-flex h-5 items-center rounded-pill border px-2 text-[10px] font-medium ${
                          TIER_TONE[option.tier]
                        }`}
                      >
                        {TIER_LABEL[option.tier]}
                      </span>
                      {isActive ? (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary" />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {showThinking ? (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-hairline pt-3">
              <div className="flex flex-col">
                <span className="text-xs font-medium text-primary">Thinking depth</span>
                <span className="text-[11px] text-muted">
                  Higher depth = slower, more deliberate replies.
                </span>
              </div>
              <div
                role="radiogroup"
                aria-label="Thinking depth"
                className="flex shrink-0 items-center gap-0.5 rounded-pill border border-hairline bg-card-raised p-0.5"
              >
                {visibleThinkingLevels.map((level) => {
                  const active = selectedThinking === level
                  return (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setThinking(level)}
                      className={`rounded-pill px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                        active
                          ? 'bg-accent-primary/20 text-accent-primary'
                          : 'text-muted hover:text-primary'
                      }`}
                    >
                      {THINKING_LABEL[level]}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}

function thinkingForOption(
  option: ModelOption,
  thinking: ThinkingLevel,
): Exclude<ThinkingLevel, 'off'> | undefined {
  if (thinking === 'off') return undefined
  return option.supportedThinkingLevels?.includes(thinking) ? thinking : undefined
}

function thinkingLevelsForSelection(
  selectedOption: ModelOption | null,
  autoActive: boolean,
): Array<Exclude<ThinkingLevel, 'off'>> {
  if (autoActive) return AUTO_THINKING_LEVELS
  return selectedOption?.supportedThinkingLevels ?? []
}
