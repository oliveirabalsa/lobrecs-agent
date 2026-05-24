import type { KeyboardEvent, MouseEvent } from 'react'
import type { GitBranchNode } from '../../../../shared/contracts/gitGraph'

interface BranchRowProps {
  node: GitBranchNode
  xOffset: number
  topY: number
  laneHeight: number
  onClick?: () => void
}

const COMMIT_SPACING = 22
const LABEL_OFFSET = 12
const DIRTY_DOT_OFFSET = 14

export function BranchRow({ node, xOffset, topY, laneHeight, onClick }: BranchRowProps) {
  const interactive = Boolean(onClick) && !node.isDefault
  const label = truncateBranchName(node.branch)
  const dotColorClass = colorClassForNode(node)
  const aheadBehind = formatAheadBehind(node)

  const laneTop = topY
  const laneBottom = topY + Math.max(laneHeight, COMMIT_SPACING)

  const handleClick = (event: MouseEvent<SVGGElement>) => {
    if (!onClick) return
    event.stopPropagation()
    onClick()
  }

  const handleKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (!onClick) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick()
    }
  }

  return (
    <g
      data-testid="branch-row"
      data-branch={node.branch}
      data-x={xOffset}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? handleClick : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      className={interactive ? 'cursor-pointer outline-none focus-visible:opacity-80' : undefined}
    >
      {!node.isDefault ? (
        <line
          x1={xOffset}
          y1={laneTop}
          x2={xOffset}
          y2={laneBottom}
          className="stroke-hairline"
          strokeWidth={1}
        />
      ) : null}

      <circle
        data-testid="branch-head-dot"
        cx={xOffset}
        cy={laneTop}
        r={4}
        className={dotColorClass}
        fill="currentColor"
      />

      {node.dirtyFileCount > 0 ? (
        <circle
          data-testid="dirty-indicator"
          cx={xOffset + DIRTY_DOT_OFFSET}
          cy={laneTop}
          r={3}
          className="text-amber-400"
          fill="currentColor"
        />
      ) : null}

      <text
        data-testid="branch-label"
        x={xOffset + LABEL_OFFSET + (node.dirtyFileCount > 0 ? DIRTY_DOT_OFFSET : 0)}
        y={laneTop + 4}
        className={`text-[11px] font-medium ${labelColorClass(node)}`}
        fill="currentColor"
      >
        {label}
      </text>

      {aheadBehind ? (
        <text
          data-testid="branch-counts"
          x={xOffset + LABEL_OFFSET + (node.dirtyFileCount > 0 ? DIRTY_DOT_OFFSET : 0)}
          y={laneTop + 18}
          className="text-[10px] text-muted"
          fill="currentColor"
        >
          {aheadBehind}
        </text>
      ) : null}
    </g>
  )
}

function colorClassForNode(node: GitBranchNode): string {
  if (node.sessionId) return 'text-accent-primary'
  if (node.isDefault) return 'text-muted'
  return 'text-secondary'
}

function labelColorClass(node: GitBranchNode): string {
  return node.sessionId ? 'text-accent-primary' : 'text-secondary'
}

function truncateBranchName(branch: string): string {
  if (branch.length <= 24) return branch
  return `${branch.slice(0, 23)}…`
}

function formatAheadBehind(node: GitBranchNode): string | null {
  const parts: string[] = []
  if (node.aheadCount > 0) parts.push(`↑${node.aheadCount}`)
  if (node.behindCount > 0) parts.push(`↓${node.behindCount}`)
  return parts.length > 0 ? parts.join(' ') : null
}
