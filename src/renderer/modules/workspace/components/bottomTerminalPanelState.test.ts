import { describe, expect, it } from 'vitest'
import { resolveBottomTerminalOpenAction } from './bottomTerminalPanelState'

describe('resolveBottomTerminalOpenAction', () => {
  it('creates the first terminal tab when no panel exists yet', () => {
    expect(
      resolveBottomTerminalOpenAction({
        hasPanel: false,
        panelOpen: false,
        canAddTab: false,
      }),
    ).toBe('create-initial-tab')
  })

  it('shows a hidden terminal panel without replacing the active terminal', () => {
    expect(
      resolveBottomTerminalOpenAction({
        hasPanel: true,
        panelOpen: false,
        canAddTab: true,
      }),
    ).toBe('show-existing-panel')
  })

  it('adds a tab only when the mounted panel is already visible', () => {
    expect(
      resolveBottomTerminalOpenAction({
        hasPanel: true,
        panelOpen: true,
        canAddTab: true,
      }),
    ).toBe('add-tab')
  })
})
