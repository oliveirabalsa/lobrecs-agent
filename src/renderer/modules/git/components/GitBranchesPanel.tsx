import { useEffect, useRef } from 'react'
import type { GitBranchEntry, GitTuiPanelId } from '../state/gitTuiState'
import { GitSidePanel, GitTuiRow } from './GitSidePanel'

interface GitBranchesPanelProps {
  branches: GitBranchEntry[]
  active: boolean
  selectedIndex: number
  onFocus: (panelId: GitTuiPanelId) => void
  onSelectIndex?: (index: number) => void
  onCheckout?: (branch: GitBranchEntry) => void
}

export function GitBranchesPanel({
  branches,
  active,
  selectedIndex,
  onFocus,
  onSelectIndex,
  onCheckout,
}: GitBranchesPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active || !scrollRef.current) return
    const row = scrollRef.current.children[selectedIndex] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [active, selectedIndex])

  return (
    <GitSidePanel
      id="branches"
      title="Branches"
      hotkey="3"
      active={active}
      itemCount={branches.length}
      onFocus={onFocus}
    >
      <div ref={scrollRef} className="h-full overflow-y-auto py-1">
        {branches.length > 0 ? (
          branches.map((branch, index) => (
            <GitTuiRow
              key={branch.name}
              selected={active && selectedIndex === index}
              onClick={() => {
                onFocus('branches')
                onSelectIndex?.(index)
              }}
              onDoubleClick={() => onCheckout?.(branch)}
            >
              <span className={branch.current ? 'text-accent-primary' : 'text-muted'}>
                {branch.current ? '*' : ' '}
              </span>{' '}
              <span>{branch.name}</span>
              {branch.ahead || branch.behind ? (
                <span className="text-muted"> +{branch.ahead} -{branch.behind}</span>
              ) : null}
            </GitTuiRow>
          ))
        ) : (
          <GitTuiRow selected={false} muted>
            no branches loaded
          </GitTuiRow>
        )}
      </div>
    </GitSidePanel>
  )
}
