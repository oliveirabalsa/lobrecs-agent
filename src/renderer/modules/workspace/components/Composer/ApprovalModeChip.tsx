import { useEffect, useRef, useState } from 'react'
import { Pill, type PillTone } from '../../../../components/ui'
import type { ApprovalMode } from './types'

interface ApprovalModeChipProps {
  mode: ApprovalMode
  onChange: (mode: ApprovalMode) => void
}

interface ApprovalModeMeta {
  label: string
  icon: string
  tone: PillTone
}

const MODE_META: Record<ApprovalMode, ApprovalModeMeta> = {
  full: { label: 'Full access', icon: '⊘', tone: 'warn' },
  'auto-safe': { label: 'Auto-approve safe', icon: '✓', tone: 'info' },
  manual: { label: 'Manual approve', icon: '⊙', tone: 'neutral' },
}

const MODES: ApprovalMode[] = ['manual', 'auto-safe', 'full']

/**
 * Status chip with a chevron dropdown that lets the user pick an approval
 * posture. Currently visual-only — selection persists to localStorage but
 * is NOT yet wired to dispatch.
 *
 * TODO: M7+ — wire to agent:set-approval-mode IPC once contract exists.
 */
export function ApprovalModeChip({ mode, onChange }: ApprovalModeChipProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(event: MouseEvent) {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(event.target as Node)) setOpen(false)
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

  const meta = MODE_META[mode]

  return (
    <div ref={wrapperRef} className="relative">
      <Pill
        tone={meta.tone}
        leadingIcon={<span aria-hidden="true">{meta.icon}</span>}
        trailingIcon={<ChevronDownIcon />}
        onClick={() => setOpen((value) => !value)}
        className="max-w-[150px] sm:max-w-none"
      >
        {meta.label}
      </Pill>
      {open ? (
        <div
          role="menu"
          aria-label="Approval mode"
          className="absolute bottom-8 left-0 z-50 w-52 overflow-hidden rounded-card border border-hairline bg-card-raised py-1 shadow-xl shadow-black/40"
        >
          {MODES.map((option) => {
            const optMeta = MODE_META[option]
            const isActive = option === mode
            return (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  onChange(option)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                  isActive
                    ? 'bg-white/5 text-primary'
                    : 'text-secondary hover:bg-white/5 hover:text-primary'
                }`}
              >
                <span className="inline-flex h-4 w-4 items-center justify-center text-[12px]">
                  {optMeta.icon}
                </span>
                <span className="flex-1">{optMeta.label}</span>
                {isActive ? <span className="text-accent-primary">●</span> : null}
              </button>
            )
          })}
        </div>
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
