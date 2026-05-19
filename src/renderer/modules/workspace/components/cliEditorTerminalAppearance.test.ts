import { describe, expect, it } from 'vitest'
import {
  CLI_EDITOR_TERMINAL_OPTIONS,
  CLI_EDITOR_TERMINAL_THEME,
} from './cliEditorTerminalAppearance'

describe('CLI editor terminal appearance', () => {
  it('keeps normal-mode block cursors visible on dark editor themes', () => {
    expect(CLI_EDITOR_TERMINAL_OPTIONS.cursorStyle).toBe('block')
    expect(CLI_EDITOR_TERMINAL_OPTIONS.cursorInactiveStyle).toBe('block')
    expect(CLI_EDITOR_TERMINAL_THEME.cursor).toBe('#fbbf24')
    expect(CLI_EDITOR_TERMINAL_THEME.cursorAccent).toBe(CLI_EDITOR_TERMINAL_THEME.background)
  })

  it('blinks the cursor so vim normal mode stays visible during screen redraws', () => {
    // xterm.js v5 only repaints the cursor on its blink timer or when cursor
    // options change. With cursorBlink=false the block gets painted over by
    // vim's redraws and disappears in normal mode. cursorBlink=true keeps the
    // render loop alive so the block reappears at least every blink cycle.
    expect(CLI_EDITOR_TERMINAL_OPTIONS.cursorBlink).toBe(true)
  })
})
