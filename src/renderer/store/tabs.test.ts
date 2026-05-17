import { describe, expect, it } from 'vitest'
import { initialTabsState, tabsReducer, type Tab } from './tabs'

describe('tabsReducer', () => {
  it('adds a tab and makes it active', () => {
    const tab = createTab('session-1')

    const state = tabsReducer(initialTabsState, { type: 'ADD_TAB', tab })

    expect(state.tabs).toEqual([tab])
    expect(state.activeTabId).toBe('session-1')
  })

  it('updates status by session id', () => {
    const state = tabsReducer(
      { tabs: [createTab('session-1')], activeTabId: 'session-1' },
      { type: 'UPDATE_STATUS', sessionId: 'session-1', status: 'done' },
    )

    expect(state.tabs[0].status).toBe('done')
  })

  it('keeps the active tab when closing an inactive tab', () => {
    const state = tabsReducer(
      {
        tabs: [createTab('session-1'), createTab('session-2')],
        activeTabId: 'session-2',
      },
      { type: 'CLOSE_TAB', sessionId: 'session-1' },
    )

    expect(state.activeTabId).toBe('session-2')
  })

  it('falls back to the last tab when closing the active tab', () => {
    const state = tabsReducer(
      {
        tabs: [createTab('session-1'), createTab('session-2')],
        activeTabId: 'session-2',
      },
      { type: 'CLOSE_TAB', sessionId: 'session-2' },
    )

    expect(state.activeTabId).toBe('session-1')
  })
})

function createTab(sessionId: string): Tab {
  return {
    sessionId,
    projectId: 'project-1',
    prompt: `Prompt for ${sessionId}`,
    status: 'running',
    model: 'claude-sonnet-4-6',
    tier: 'balanced',
    createdAt: 1,
  }
}
