import { describe, expect, it } from 'vitest'
import {
  CLI_EDITOR_TERMINAL_OPTIONS,
  CLI_EDITOR_TERMINAL_THEME,
} from './cliEditorTerminalAppearance'

describe('CLI editor terminal appearance', () => {
  it('keeps normal-mode block cursors visible on dark editor themes', () => {
    expect(CLI_EDITOR_TERMINAL_OPTIONS.cursorStyle).toBe('block')
    expect(CLI_EDITOR_TERMINAL_OPTIONS.cursorInactiveStyle).toBe('block')
    expect(CLI_EDITOR_TERMINAL_THEME.cursor).toBe('#a78bfa')
    expect(CLI_EDITOR_TERMINAL_THEME.cursorAccent).toBe(CLI_EDITOR_TERMINAL_THEME.background)
  })
})
