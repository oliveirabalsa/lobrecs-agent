import type { MouseEvent } from 'react'
import type {
  GitBranchNode,
  GitGraphCommit,
  GitGraphData,
} from '../../../../shared/contracts/gitGraph'
import { BranchRow } from './BranchRow'

export type CommitHoverCoords = { x: number; y: number }
export type CommitHoverCallback = (
  commit: GitGraphCommit | null,
  node: GitBranchNode,
  coords?: CommitHoverCoords,
) => void

interface GitGraphCanvasProps {
  data: GitGraphData
  onBranchClick?: (node: GitBranchNode) => void
  onCommitHover?: CommitHoverCallback
}

const SPINE_X = 32
const LANE_SPACING = 80
const LANE_TOP = 32
const LANE_HEIGHT = 60
const SPINE_BOTTOM_PADDING = 24
const COMMIT_DOT_SPACING = 16
const COMMIT_DOT_RADIUS = 3
const HEAD_DOT_RADIUS = 4

export function GitGraphCanvas({ data, onBranchClick, onCommitHover }: GitGraphCanvasProps) {
  const layout = buildLayout(data)

  return (
    <svg
      data-testid="git-graph-canvas"
      role="img"
      aria-label="Git branch graph"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width="100%"
      preserveAspectRatio="xMinYMin meet"
      className="max-w-full"
    >
      {layout.defaultLane ? (
        <line
          data-testid="spine"
          x1={SPINE_X}
          y1={LANE_TOP}
          x2={SPINE_X}
          y2={layout.spineBottom}
          className="stroke-hairline"
          strokeWidth={1}
        />
      ) : null}

      {layout.lanes.map((lane) => {
        const isDefault = lane.node.isDefault
        const connectorY = lane.topY
        return (
          <g key={lane.node.branch} data-testid="branch-group" data-branch={lane.node.branch}>
            {!isDefault ? (
              <line
                data-testid="branch-connector"
                x1={SPINE_X}
                y1={connectorY}
                x2={lane.x}
                y2={connectorY}
                className="stroke-hairline"
                strokeWidth={1}
              />
            ) : null}
            <BranchRow
              node={lane.node}
              xOffset={lane.x}
              topY={lane.topY}
              laneHeight={LANE_HEIGHT}
              onClick={bindBranchClick(lane.node, onBranchClick)}
            />
            {lane.node.recentCommits.map((commit, commitIndex) => {
              const cy = lane.topY + HEAD_DOT_RADIUS + COMMIT_DOT_SPACING * (commitIndex + 1)
              const hover = bindCommitHover(commit, lane.node, onCommitHover)
              return (
                <circle
                  key={commit.sha}
                  data-testid="commit-dot"
                  data-commit-sha={commit.sha}
                  cx={lane.x}
                  cy={cy}
                  r={COMMIT_DOT_RADIUS}
                  className="text-muted"
                  fill="currentColor"
                  onMouseEnter={hover?.onEnter}
                  onMouseLeave={hover?.onLeave}
                />
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

export function bindBranchClick(
  node: GitBranchNode,
  onBranchClick: ((node: GitBranchNode) => void) | undefined,
): (() => void) | undefined {
  if (!onBranchClick) return undefined
  return () => onBranchClick(node)
}

interface CommitHoverBinding {
  onEnter: (event: MouseEvent<SVGCircleElement>) => void
  onLeave: () => void
}

export function bindCommitHover(
  commit: GitGraphCommit,
  node: GitBranchNode,
  onCommitHover: CommitHoverCallback | undefined,
): CommitHoverBinding | undefined {
  if (!onCommitHover) return undefined
  return {
    onEnter: (event) =>
      onCommitHover(commit, node, { x: event.clientX, y: event.clientY }),
    onLeave: () => onCommitHover(null, node),
  }
}

interface BranchLane {
  node: GitBranchNode
  x: number
  topY: number
}

interface CanvasLayout {
  defaultLane: BranchLane | null
  lanes: BranchLane[]
  width: number
  height: number
  spineBottom: number
}

function buildLayout(data: GitGraphData): CanvasLayout {
  const defaultNode = data.nodes.find((node) => node.isDefault) ?? null
  const otherNodes = data.nodes.filter((node) => !node.isDefault)

  const lanes: BranchLane[] = []
  let defaultLane: BranchLane | null = null

  if (defaultNode) {
    defaultLane = { node: defaultNode, x: SPINE_X, topY: LANE_TOP }
    lanes.push(defaultLane)
  }

  otherNodes.forEach((node, index) => {
    lanes.push({
      node,
      x: SPINE_X + LANE_SPACING * (index + 1),
      topY: LANE_TOP + (index % 3) * 24,
    })
  })

  const width = Math.max(
    SPINE_X + LANE_SPACING * Math.max(otherNodes.length, 1) + 160,
    SPINE_X + 200,
  )
  const tallestCommitColumn = lanes.reduce((max, lane) => {
    const commitCount = lane.node.recentCommits.length
    const commitsBottom = lane.topY + HEAD_DOT_RADIUS + COMMIT_DOT_SPACING * commitCount
    return Math.max(max, commitsBottom, lane.topY + LANE_HEIGHT)
  }, LANE_TOP)
  const height = tallestCommitColumn + SPINE_BOTTOM_PADDING
  const spineBottom = height - SPINE_BOTTOM_PADDING / 2

  return { defaultLane, lanes, width, height, spineBottom }
}
