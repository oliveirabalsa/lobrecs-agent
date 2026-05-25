import type { ReactNode } from 'react'
import type { GitTuiPanelId } from '../state/gitTuiState'

interface GitSidePanelProps {
  id: GitTuiPanelId
  title: string
  hotkey: string
  active: boolean
  compact?: boolean
  itemCount?: number
  children: ReactNode
  onFocus: (panelId: GitTuiPanelId) => void
}

export function GitSidePanel({
  id,
  title,
  hotkey,
  active,
  compact,
  itemCount,
  children,
  onFocus,
}: GitSidePanelProps) {
  return (
    <section
      aria-label={title}
      style={compact ? undefined : { flex: active ? '3 1 0%' : '1 1 0%' }}
      className={`flex min-h-0 flex-col border bg-black/10 transition-[flex] duration-150 ease-out ${
        compact ? 'shrink-0' : ''
      } ${
        active ? 'border-accent-primary/70 shadow-[inset_3px_0_0_rgba(98,179,255,0.85)]' : 'border-hairline'
      }`}
    >
      <button
        type="button"
        onClick={() => onFocus(id)}
        className="flex h-7 w-full shrink-0 items-center justify-between border-b border-hairline bg-white/[0.025] px-2 text-left font-mono text-[11px] uppercase text-secondary hover:bg-white/[0.04]"
      >
        <span className={active ? 'text-primary' : undefined}>
          {hotkey} {title}
        </span>
        {typeof itemCount === 'number' ? (
          <span className="text-[10px] text-muted">{itemCount}</span>
        ) : null}
      </button>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  )
}

interface GitTuiRowProps {
  selected: boolean
  muted?: boolean
  onClick?: () => void
  onDoubleClick?: () => void
  children: ReactNode
}

export function GitTuiRow({ selected, muted = false, onClick, onDoubleClick, children }: GitTuiRowProps) {
  const interactive = Boolean(onClick || onDoubleClick)

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? -1 : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`grid h-6 min-w-0 grid-cols-[18px_minmax(0,1fr)] items-center gap-1 px-2 font-mono text-[11px] leading-none ${
        selected
          ? 'bg-accent-primary/18 text-primary'
          : muted
            ? 'text-muted'
            : 'text-secondary'
      } ${interactive && !selected ? 'cursor-pointer hover:bg-white/[0.06]' : ''} ${interactive && selected ? 'cursor-pointer' : ''}`}
    >
      <span className={selected ? 'text-accent-primary' : 'text-muted'}>{selected ? '>' : ' '}</span>
      <div className="min-w-0 truncate">{children}</div>
    </div>
  )
}
