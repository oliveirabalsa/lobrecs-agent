import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  AGENT_SHORT,
  THINKING_LABEL,
  TIER_LABEL,
  TIER_TONE,
  supportsThinking,
} from './modelDisplay'
import {
  calculateModelPopoverFixedPosition,
  type ModelPopoverFixedPosition,
} from './modelPopoverPosition'
import type { ModelGroup, ModelOption, ModelSelection, ThinkingLevel } from './types'

const AUTO_THINKING_LEVELS: Array<Exclude<ThinkingLevel, 'off'>> = [
  'low',
  'medium',
  'high',
  'xhigh',
]

interface ModelPopoverProps {
  open: boolean
  groups: ModelGroup[]
  selection: ModelSelection
  onSelect: (selection: ModelSelection) => void
  onClose: () => void
  allowAuto?: boolean
  showThinkingControl?: boolean
  anchorRef?: RefObject<HTMLElement | null>
}

/**
 * Compact model picker: provider tabs on the left, model rows on the right
 * with a thinking-depth segmented control for models that support it.
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
  anchorRef,
}: ModelPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [fixedPosition, setFixedPosition] = useState<ModelPopoverFixedPosition | null>(null)
  const isViewportAnchored = anchorRef !== undefined
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

  useEffect(() => {
    if (!open) return undefined

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && panelRef.current?.contains(target)) return
      if (target instanceof Node && anchorRef?.current?.contains(target)) return
      onClose()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [anchorRef, onClose, open])

  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) {
      setFixedPosition(null)
      return undefined
    }

    function updatePosition() {
      const anchor = anchorRef?.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      setFixedPosition(
        calculateModelPopoverFixedPosition(
          { top: rect.top, right: rect.right, bottom: rect.bottom },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      )
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, open])

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

  if (!open) return null

  const fixedStyle = fixedPosition
    ? ({
        left: fixedPosition.left,
        top: fixedPosition.top,
        width: fixedPosition.width,
        maxHeight: fixedPosition.maxHeight,
        transformOrigin: fixedPosition.transformOrigin,
      } satisfies CSSProperties)
    : undefined
  const viewportContentStyle =
    fixedPosition !== null
      ? ({ maxHeight: Math.max(240, fixedPosition.maxHeight - 20) } satisfies CSSProperties)
      : undefined

  const popover = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Select model"
      aria-describedby="model-popover-description"
      style={isViewportAnchored ? fixedStyle : undefined}
      className={`${
        isViewportAnchored
          ? `fixed z-[1000] ${fixedPosition ? '' : 'invisible'}`
          : 'absolute bottom-full right-0 z-50 mb-2 w-[min(480px,calc(100vw-32px))]'
      } overflow-hidden rounded-card border border-hairline bg-card/95 p-2.5 font-ui text-primary shadow-2xl shadow-black/45 backdrop-blur-md`}
    >
      <p id="model-popover-description" className="sr-only">
        Choose an agent, model, and thinking depth.
      </p>
      <div
        style={isViewportAnchored ? viewportContentStyle : undefined}
        className="flex max-h-[min(380px,calc(100vh-180px))] min-h-[240px] gap-2.5"
      >
        <nav
          aria-label="Provider"
          className="flex w-24 shrink-0 flex-col gap-0.5 border-r border-hairline/80 pr-2"
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
                className={`flex items-center justify-between gap-1 rounded px-2 py-1 text-left text-[11px] transition-colors ${
                  active
                    ? 'bg-white/10 text-primary'
                    : 'text-muted hover:bg-white/5 hover:text-primary'
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
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {activeTab === 'auto' ? (
              <button
                type="button"
                onClick={pickAuto}
                className={`flex w-full flex-col gap-0.5 rounded-card border px-3 py-2 text-left transition-colors ${
                  autoActive
                    ? 'border-accent-primary/40 bg-accent-primary/5'
                    : 'border-hairline hover:border-white/15 hover:bg-white/5'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-primary">Auto routing</span>
                  {autoActive ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-primary" />
                  ) : null}
                </div>
                <span className="text-[11px] text-muted">
                  Router scores complexity and picks the best agent + model per turn.
                </span>
              </button>
            ) : (
              <div className="flex flex-col gap-1">
                {activeGroup?.account ? (
                  <div className="mb-2 rounded-card border border-hairline/80 bg-card-raised/80 px-3 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium uppercase text-muted">
                        Account
                      </span>
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          activeGroup.account.status === 'authenticated'
                            ? 'bg-accent-add'
                            : activeGroup.account.status === 'unauthenticated'
                              ? 'bg-accent-del'
                              : 'bg-accent-warn'
                        }`}
                      />
                    </div>
                    <div className="mt-0.5 truncate text-xs font-medium text-primary">
                      {activeGroup.account.label}
                    </div>
                    {activeGroup.account.detail ? (
                      <div className="mt-0.5 line-clamp-2 text-[10px] leading-3 text-muted">
                        {activeGroup.account.detail}
                      </div>
                    ) : null}
                  </div>
                ) : null}
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
                      className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left transition-colors ${
                        isActive
                          ? 'border-accent-primary/40 bg-accent-primary/5'
                          : 'border-transparent hover:border-white/10 hover:bg-white/5'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-xs text-primary">
                        {option.label}
                      </span>
                      <span
                        className={`inline-flex h-[18px] items-center rounded-pill border px-1.5 text-[9px] font-medium ${
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
            <div className="mt-2.5 flex flex-col gap-2.5 border-t border-hairline/80 pt-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col">
                <span className="text-[11px] font-medium text-primary">Thinking depth</span>
                <span className="text-[10px] leading-4 text-muted">
                  Higher depth = slower, more deliberate replies.
                </span>
              </div>
              <div
                role="radiogroup"
                aria-label="Thinking depth"
                className="grid shrink-0 grid-cols-3 gap-0.5 rounded-md border border-hairline bg-card-raised/80 p-0.5 sm:flex sm:items-center"
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
                      className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
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
    </div>
  )

  if (isViewportAnchored && typeof document !== 'undefined') {
    return createPortal(popover, document.body)
  }

  return popover
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
