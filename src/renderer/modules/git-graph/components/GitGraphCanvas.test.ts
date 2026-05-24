import type { MouseEvent } from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type {
  GitBranchNode,
  GitGraphCommit,
  GitGraphData,
} from '../../../../shared/contracts/gitGraph'
import { bindBranchClick, bindCommitHover, GitGraphCanvas } from './GitGraphCanvas'

function makeCommit(overrides: Partial<GitGraphCommit> = {}): GitGraphCommit {
  return {
    sha: overrides.sha ?? 'c'.repeat(40),
    shortSha: overrides.shortSha ?? 'cccccccc',
    message: overrides.message ?? 'chore: example',
    author: overrides.author ?? 'Test Author',
    date: overrides.date ?? new Date(0).toISOString(),
  }
}

function makeNode(overrides: Partial<GitBranchNode> = {}): GitBranchNode {
  return {
    branch: overrides.branch ?? 'feature/x',
    isDefault: overrides.isDefault ?? false,
    headSha: overrides.headSha ?? 'a'.repeat(40),
    baseCommitSha: overrides.baseCommitSha ?? 'b'.repeat(40),
    aheadCount: overrides.aheadCount ?? 0,
    behindCount: overrides.behindCount ?? 0,
    dirtyFileCount: overrides.dirtyFileCount ?? 0,
    firstCommitDate: overrides.firstCommitDate ?? new Date(0).toISOString(),
    mergeStatus: overrides.mergeStatus ?? 'clean',
    recentCommits: overrides.recentCommits ?? [],
    sessionId: overrides.sessionId,
    worktreePath: overrides.worktreePath,
  }
}

function makeGraph(nodes: GitBranchNode[]): GitGraphData {
  return {
    projectId: 'p1',
    defaultBranch: 'main',
    capturedAt: new Date(0).toISOString(),
    nodes,
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let index = 0
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1
    index += needle.length
  }
  return count
}

describe('GitGraphCanvas', () => {
  it('renders one branch label per node (3 nodes ⇒ 3 labels)', () => {
    const html = renderToStaticMarkup(
      createElement(GitGraphCanvas, {
        data: makeGraph([
          makeNode({ branch: 'main', isDefault: true }),
          makeNode({ branch: 'feat/a' }),
          makeNode({ branch: 'feat/b' }),
        ]),
      }),
    )

    expect(countOccurrences(html, 'data-testid="branch-label"')).toBe(3)
    expect(html).toContain('>main<')
    expect(html).toContain('>feat/a<')
    expect(html).toContain('>feat/b<')
  })

  it('places the default branch at the leftmost x position (the spine)', () => {
    const html = renderToStaticMarkup(
      createElement(GitGraphCanvas, {
        data: makeGraph([
          makeNode({ branch: 'main', isDefault: true }),
          makeNode({ branch: 'feat/right' }),
        ]),
      }),
    )

    expect(html).toContain('data-branch="main" data-x="32"')
    expect(html).toContain('data-branch="feat/right" data-x="112"')
  })

  it('renders a dirty-indicator element only when dirtyFileCount > 0', () => {
    const cleanHtml = renderToStaticMarkup(
      createElement(GitGraphCanvas, {
        data: makeGraph([makeNode({ branch: 'main', isDefault: true })]),
      }),
    )
    expect(cleanHtml).not.toContain('data-testid="dirty-indicator"')

    const dirtyHtml = renderToStaticMarkup(
      createElement(GitGraphCanvas, {
        data: makeGraph([
          makeNode({ branch: 'main', isDefault: true }),
          makeNode({ branch: 'feat/dirty', dirtyFileCount: 3 }),
        ]),
      }),
    )
    expect(dirtyHtml).toContain('data-testid="dirty-indicator"')
  })

  it('applies the accent color token to worktree branches (sessionId present)', () => {
    const html = renderToStaticMarkup(
      createElement(GitGraphCanvas, {
        data: makeGraph([
          makeNode({ branch: 'main', isDefault: true }),
          makeNode({
            branch: 'agentforge/session-1',
            sessionId: 'sess-1',
            worktreePath: '/tmp/wt',
          }),
        ]),
      }),
    )

    const labelTagsWithAccent = html.match(
      /<text[^>]*data-testid="branch-label"[^>]*text-accent-primary[^>]*>/g,
    )
    expect(labelTagsWithAccent?.length).toBe(1)
  })

  it('marks interactive branches with role=button and tabIndex when onBranchClick is provided', () => {
    const html = renderToStaticMarkup(
      createElement(GitGraphCanvas, {
        data: makeGraph([
          makeNode({ branch: 'main', isDefault: true }),
          makeNode({ branch: 'feat/clickable' }),
        ]),
        onBranchClick: vi.fn(),
      }),
    )

    expect(html).toContain('data-branch="feat/clickable"')
    expect(html).toMatch(/role="button"[^>]*tabindex="0"|tabindex="0"[^>]*role="button"/)
  })

  it('bindBranchClick returns a closure that fires onBranchClick with the bound node', () => {
    const featureNode = makeNode({ branch: 'feat/clickable' })
    const onBranchClick = vi.fn()

    const handler = bindBranchClick(featureNode, onBranchClick)

    expect(handler).toBeDefined()
    handler?.()

    expect(onBranchClick).toHaveBeenCalledTimes(1)
    expect(onBranchClick).toHaveBeenCalledWith(featureNode)
  })

  it('bindBranchClick returns undefined when no onBranchClick is provided (non-interactive)', () => {
    expect(bindBranchClick(makeNode(), undefined)).toBeUndefined()
  })

  it('renders one commit dot per recent commit with sha attributes', () => {
    const commits = [
      makeCommit({ sha: 'a'.repeat(40), shortSha: 'aaaaaaaa' }),
      makeCommit({ sha: 'b'.repeat(40), shortSha: 'bbbbbbbb' }),
    ]
    const html = renderToStaticMarkup(
      createElement(GitGraphCanvas, {
        data: makeGraph([
          makeNode({ branch: 'main', isDefault: true }),
          makeNode({ branch: 'feat/with-commits', recentCommits: commits }),
        ]),
      }),
    )

    expect(countOccurrences(html, 'data-testid="commit-dot"')).toBe(2)
    expect(html).toContain(`data-commit-sha="${'a'.repeat(40)}"`)
    expect(html).toContain(`data-commit-sha="${'b'.repeat(40)}"`)
  })

  it('bindCommitHover onEnter fires with the commit, node, and coords from the event', () => {
    const node = makeNode({ branch: 'feat/hover' })
    const commit = makeCommit({ sha: 'd'.repeat(40), shortSha: 'dddddddd' })
    const onCommitHover = vi.fn()

    const binding = bindCommitHover(commit, node, onCommitHover)

    expect(binding).toBeDefined()
    binding?.onEnter({ clientX: 123, clientY: 456 } as MouseEvent<SVGCircleElement>)

    expect(onCommitHover).toHaveBeenCalledTimes(1)
    expect(onCommitHover).toHaveBeenCalledWith(commit, node, { x: 123, y: 456 })
  })

  it('bindCommitHover onLeave fires with a null commit and the node', () => {
    const node = makeNode({ branch: 'feat/hover' })
    const commit = makeCommit({ sha: 'd'.repeat(40) })
    const onCommitHover = vi.fn()

    const binding = bindCommitHover(commit, node, onCommitHover)

    binding?.onLeave()

    expect(onCommitHover).toHaveBeenCalledTimes(1)
    expect(onCommitHover).toHaveBeenCalledWith(null, node)
  })

  it('bindCommitHover returns undefined when no onCommitHover is provided', () => {
    expect(bindCommitHover(makeCommit(), makeNode(), undefined)).toBeUndefined()
  })

  it('does not render role=button or tabindex when onBranchClick is omitted', () => {
    const html = renderToStaticMarkup(
      createElement(GitGraphCanvas, {
        data: makeGraph([
          makeNode({ branch: 'main', isDefault: true }),
          makeNode({ branch: 'feat/static' }),
        ]),
      }),
    )

    expect(html).not.toContain('role="button"')
    expect(html).not.toContain('tabindex="0"')
  })
})
