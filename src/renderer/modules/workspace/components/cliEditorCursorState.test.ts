import { describe, expect, it } from 'vitest'
import {
  cursorStyleForState,
  DEFAULT_CLI_EDITOR_CURSOR_STATE,
  readCliEditorCursorStateChunk,
} from './cliEditorCursorState'

describe('cliEditorCursorState', () => {
  it('treats block cursor escape sequences as normal mode', () => {
    const result = readCliEditorCursorStateChunk('', '\u001b[2 q')

    expect(result.state).toEqual(DEFAULT_CLI_EDITOR_CURSOR_STATE)
  })

  it('maps bar and underline cursor shapes to insert and replace indicators', () => {
    const insert = readCliEditorCursorStateChunk('', '\u001b[6 q')
    const replace = readCliEditorCursorStateChunk('', '\u001b[4 q')

    expect(insert.state).toEqual({
      mode: 'insert',
      shape: 'bar',
      label: 'Insert',
    })
    expect(replace.state).toEqual({
      mode: 'replace',
      shape: 'underline',
      label: 'Replace',
    })
  })

  it('handles cursor escape sequences split across pty chunks', () => {
    const first = readCliEditorCursorStateChunk('', '\u001b[6')
    const second = readCliEditorCursorStateChunk(first.remainder, ' qhello')

    expect(first.state).toBeUndefined()
    expect(second.state).toEqual({
      mode: 'insert',
      shape: 'bar',
      label: 'Insert',
    })
  })

  it('enables blink so xterm.js keeps repainting the block cursor in vim normal mode', () => {
    expect(cursorStyleForState(DEFAULT_CLI_EDITOR_CURSOR_STATE)).toEqual({
      cursorStyle: 'block',
      cursorBlink: true,
    })
  })
})
