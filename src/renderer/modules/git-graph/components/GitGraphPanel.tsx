import { useCallback, useState } from 'react'
import type {
  GitBranchNode,
  GitGraphCommit,
} from '../../../../shared/contracts/gitGraph'
import type { Project } from '../../../../shared/types'
import { formatRelative } from '../../../lib/relativeTime'
import { useGitGraphData } from '../hooks/useGitGraphData'
import {
  GitGraphCanvas,
  type CommitHoverCoords,
} from './GitGraphCanvas'

interface GitGraphPanelProps {
  project: Project | null
  onOpenSession?: (sessionId: string) => void
  onOpenBranchManager?: (branchName: string) => void
}

interface HoveredCommitState {
  commit: GitGraphCommit
  node: GitBranchNode
  x: number
  y: number
}

export function GitGraphPanel({
  project,
  onOpenSession,
  onOpenBranchManager,
}: GitGraphPanelProps) {
  const { data, loading, error, refresh } = useGitGraphData(project)
  const [hoveredCommit, setHoveredCommit] = useState<HoveredCommitState | null>(null)

  const handleBranchClick = useCallback(
    (node: GitBranchNode) => {
      if (node.sessionId && onOpenSession) {
        onOpenSession(node.sessionId)
        return
      }
      if (!node.isDefault && onOpenBranchManager) {
        onOpenBranchManager(node.branch)
      }
    },
    [onOpenSession, onOpenBranchManager],
  )

  const handleCommitHover = useCallback(
    (
      commit: GitGraphCommit | null,
      node: GitBranchNode,
      coords?: CommitHoverCoords,
    ) => {
      if (!commit || !coords) {
        setHoveredCommit(null)
        return
      }
      setHoveredCommit({ commit, node, x: coords.x, y: coords.y })
    },
    [],
  )

  if (!project) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="text-[15px] font-semibold text-primary">Select a project</div>
          <p className="mt-2 text-[13px] leading-6 text-muted">
            Choose a repository to view its branch graph.
          </p>
        </div>
      </div>
    )
  }

  const isEmpty = !loading && !error && data !== null && data.nodes.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-semibold text-primary">{project.name}</span>
          <span className="truncate text-[11px] text-muted">
            Git graph{data?.defaultBranch ? ` · default: ${data.defaultBranch}` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="shrink-0 rounded-card border border-hairline px-2 py-1 text-[11px] font-medium text-secondary transition-colors hover:border-white/15 hover:bg-white/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {error ? (
          <div className="flex items-start justify-between gap-3 rounded-card border border-accent-del/40 bg-accent-del/10 px-3 py-2 text-xs text-accent-del">
            <span className="min-w-0 break-words">{error}</span>
            <button
              type="button"
              onClick={refresh}
              className="shrink-0 rounded border border-accent-del/40 px-2 py-0.5 text-[11px] font-medium text-accent-del hover:bg-accent-del/20"
            >
              Retry
            </button>
          </div>
        ) : null}

        {loading && !data ? (
          <div className="rounded-md border border-dashed border-hairline px-4 py-8 text-center text-sm text-muted">
            Loading branch graph…
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-hairline px-4 py-8 text-center text-sm text-muted">
            <span>No branches to show.</span>
            <button
              type="button"
              onClick={refresh}
              className="rounded-card border border-hairline px-2 py-1 text-[11px] font-medium text-secondary transition-colors hover:border-white/15 hover:bg-white/5 hover:text-primary"
            >
              Refresh
            </button>
          </div>
        ) : data ? (
          <div className="min-w-0 overflow-x-auto rounded-card border border-hairline bg-card-raised p-3">
            <GitGraphCanvas
              data={data}
              onBranchClick={handleBranchClick}
              onCommitHover={handleCommitHover}
            />
          </div>
        ) : null}
      </div>

      {hoveredCommit ? <CommitTooltip state={hoveredCommit} /> : null}
    </div>
  )
}

function CommitTooltip({ state }: { state: HoveredCommitState }) {
  const message = truncateMessage(state.commit.message)
  return (
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        left: state.x + 12,
        top: state.y + 12,
        pointerEvents: 'none',
        zIndex: 60,
      }}
      className="max-w-[320px] overflow-hidden rounded-card border border-hairline bg-card-raised/95 px-3 py-2 text-[11px] shadow-xl shadow-black/40 backdrop-blur-md"
    >
      <div className="flex items-center justify-between gap-2 text-muted">
        <span className="font-mono text-[10px] uppercase tracking-wide">
          {state.commit.shortSha}
        </span>
        <span>{formatRelative(state.commit.date)}</span>
      </div>
      <div className="mt-1 break-words text-[12px] font-medium text-primary">{message}</div>
      <div className="mt-1 truncate text-[10px] text-muted">{state.commit.author}</div>
    </div>
  )
}

function truncateMessage(message: string): string {
  const trimmed = message.trim()
  if (trimmed.length <= 80) return trimmed
  return `${trimmed.slice(0, 79)}…`
}
