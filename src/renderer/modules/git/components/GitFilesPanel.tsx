import { useEffect, useRef } from 'react'
import type { GitFileEntry, GitTuiPanelId } from '../state/gitTuiState'
import { GitSidePanel, GitTuiRow } from './GitSidePanel'

interface GitFilesPanelProps {
  files: GitFileEntry[]
  active: boolean
  selectedIndex: number
  fallbackChangeCount?: number
  onFocus: (panelId: GitTuiPanelId) => void
  onSelectIndex?: (index: number) => void
  onToggleStage?: (file: GitFileEntry) => void
}

export function GitFilesPanel({
  files,
  active,
  selectedIndex,
  fallbackChangeCount = 0,
  onFocus,
  onSelectIndex,
  onToggleStage,
}: GitFilesPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active || !scrollRef.current) return
    const row = scrollRef.current.children[selectedIndex] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [active, selectedIndex])

  return (
    <GitSidePanel
      id="files"
      title="Files"
      hotkey="2"
      active={active}
      itemCount={files.length || fallbackChangeCount}
      onFocus={onFocus}
    >
      <div ref={scrollRef} className="h-full overflow-y-auto py-1">
        {files.length > 0 ? (
          files.map((file, index) => (
            <GitTuiRow
              key={file.id}
              selected={active && selectedIndex === index}
              onClick={() => {
                onFocus('files')
                onSelectIndex?.(index)
              }}
              onDoubleClick={() => onToggleStage?.(file)}
            >
              <span className={file.staged ? 'text-accent-add' : 'text-amber-300'}>
                {file.staged ? 'S' : 'U'}
              </span>{' '}
              <span className="text-muted">{statusCode(file.status)}</span>{' '}
              <span>{file.path}</span>
            </GitTuiRow>
          ))
        ) : fallbackChangeCount > 0 ? (
          <GitTuiRow selected={active} muted>
            {fallbackChangeCount} changed file{fallbackChangeCount === 1 ? '' : 's'} waiting for snapshot
          </GitTuiRow>
        ) : (
          <GitTuiRow selected={false} muted>
            clean working tree
          </GitTuiRow>
        )}
      </div>
    </GitSidePanel>
  )
}

function statusCode(status: GitFileEntry['status']): string {
  const codes: Record<GitFileEntry['status'], string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    untracked: '?',
    'type-changed': 'T',
    unchanged: ' ',
    conflicted: 'U',
    unknown: '!',
  }
  return codes[status]
}
