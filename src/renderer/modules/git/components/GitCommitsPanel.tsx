import { useEffect, useRef } from 'react'
import type { GitCommitEntry, GitTuiPanelId } from '../state/gitTuiState'
import { GitSidePanel, GitTuiRow } from './GitSidePanel'

interface GitCommitsPanelProps {
  commits: GitCommitEntry[]
  active: boolean
  selectedIndex: number
  onFocus: (panelId: GitTuiPanelId) => void
  onSelectIndex?: (index: number) => void
  onViewDetail?: (commit: GitCommitEntry) => void
}

export function GitCommitsPanel({
  commits,
  active,
  selectedIndex,
  onFocus,
  onSelectIndex,
  onViewDetail,
}: GitCommitsPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active || !scrollRef.current) return
    const row = scrollRef.current.children[selectedIndex] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [active, selectedIndex])

  return (
    <GitSidePanel
      id="commits"
      title="Commits"
      hotkey="4"
      active={active}
      itemCount={commits.length}
      onFocus={onFocus}
    >
      <div ref={scrollRef} className="h-full overflow-y-auto py-1">
        {commits.length > 0 ? (
          commits.map((commit, index) => (
            <GitTuiRow
              key={commit.hash}
              selected={active && selectedIndex === index}
              onClick={() => {
                onFocus('commits')
                onSelectIndex?.(index)
              }}
              onDoubleClick={() => onViewDetail?.(commit)}
            >
              <span className="text-muted">{commit.graph ?? '*'}</span>{' '}
              <span className="text-accent-primary">{commit.shortHash}</span>{' '}
              <span>{commit.summary}</span>
            </GitTuiRow>
          ))
        ) : (
          <GitTuiRow selected={false} muted>
            commit log waiting for snapshot
          </GitTuiRow>
        )}
      </div>
    </GitSidePanel>
  )
}
