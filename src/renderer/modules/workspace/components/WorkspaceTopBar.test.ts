import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceTopBar } from './WorkspaceTopBar'

function renderTopBar(branchName?: string | null): string {
  return renderToStaticMarkup(
    createElement(WorkspaceTopBar, {
      title: 'Repository workspace',
      model: 'auto',
      branchName,
      rightPanelOpen: false,
      rightPanelMode: 'diff',
      hasDiff: false,
      hasSwarmGraph: false,
      hasContext: true,
      hasReviews: true,
      canRerun: false,
      onToggleRightPanel: vi.fn(),
    }),
  )
}

describe('WorkspaceTopBar', () => {
  it('shows the current git branch when one is available', () => {
    const html = renderTopBar('feat/git-top-branch')

    expect(html).toContain('feat/git-top-branch')
  })

  it('does not render an empty branch chip before the branch is known', () => {
    const html = renderTopBar('   ')

    expect(html).not.toContain('branch')
  })
})
