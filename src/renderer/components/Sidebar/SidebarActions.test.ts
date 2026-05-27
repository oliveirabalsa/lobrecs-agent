import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SidebarActions } from './SidebarActions'

describe('SidebarActions', () => {
  it('renders the Git action label', () => {
    const html = renderToStaticMarkup(
      createElement(SidebarActions, {
        onNewChat: vi.fn(),
        onOpenGit: vi.fn(),
        gitActive: true,
      }),
    )

    expect(html).toContain('>Git<')
  })
})
