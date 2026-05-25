import { useEffect, useRef } from 'react'
import type { GitStashEntry, GitTuiPanelId } from '../state/gitTuiState'
import { GitSidePanel, GitTuiRow } from './GitSidePanel'

interface GitStashPanelProps {
  stash: GitStashEntry[]
  active: boolean
  selectedIndex: number
  onFocus: (panelId: GitTuiPanelId) => void
  onSelectIndex?: (index: number) => void
  onApply?: (entry: GitStashEntry) => void
}

export function GitStashPanel({
  stash,
  active,
  selectedIndex,
  onFocus,
  onSelectIndex,
  onApply,
}: GitStashPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active || !scrollRef.current) return
    const row = scrollRef.current.children[selectedIndex] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [active, selectedIndex])

  return (
    <GitSidePanel
      id="stash"
      title="Stash"
      hotkey="5"
      active={active}
      itemCount={stash.length}
      onFocus={onFocus}
    >
      <div ref={scrollRef} className="h-full overflow-y-auto py-1">
        {stash.length > 0 ? (
          stash.map((entry, index) => (
            <GitTuiRow
              key={entry.id}
              selected={active && selectedIndex === index}
              onClick={() => {
                onFocus('stash')
                onSelectIndex?.(index)
              }}
              onDoubleClick={() => onApply?.(entry)}
            >
              <span className="text-accent-primary">{entry.id}</span>{' '}
              <span>{entry.message}</span>
            </GitTuiRow>
          ))
        ) : (
          <GitTuiRow selected={false} muted>
            no stashes
          </GitTuiRow>
        )}
      </div>
    </GitSidePanel>
  )
}
