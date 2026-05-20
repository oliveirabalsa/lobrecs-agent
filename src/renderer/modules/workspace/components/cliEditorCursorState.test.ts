import { describe, expect, it, vi } from 'vitest'
import {
  applyCliEditorCursorState,
  createCliEditorCursorTracker,
  cursorStyleForState,
  DEFAULT_CLI_EDITOR_CURSOR_STATE,
  readCliEditorCursorStateChunk,
  type CliEditorCursorTerminal,
  writeTerminalWithCursorState,
} from './cliEditorCursorState'

describe('cliEditorCursorState', () => {
  it('treats block cursor escape sequences as normal mode', () => {
    const result = readCliEditorCursorStateChunk('', '\u001b[2 q')

    expect(result.state).toEqual({
      mode: 'normal',
      shape: 'block',
      label: 'Normal',
      blink: false,
    })
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
    expect(cursorStyleForState({
      ...DEFAULT_CLI_EDITOR_CURSOR_STATE,
      blink: false,
    })).toEqual({
      cursorStyle: 'block',
      cursorBlink: true,
    })
  })

  it('reapplies the parsed cursor state after xterm processes the chunk', () => {
    const refresh = vi.fn()
    const stateChanges: string[] = []
    const tracker = createCliEditorCursorTracker({
      mode: 'insert',
      shape: 'bar',
      label: 'Insert',
    })

    let term: CliEditorCursorTerminal
    term = {
      options: {
        cursorStyle: 'bar',
        cursorBlink: false,
      },
      buffer: {
        active: {
          cursorY: 7,
        },
      },
      refresh,
      write: vi.fn((data: string, callback?: () => void) => {
        expect(data).toBe('\u001b[2 q')
        term.options.cursorStyle = 'underline'
        term.options.cursorBlink = false
        callback?.()
      }),
    }

    writeTerminalWithCursorState(term, tracker, '\u001b[2 q', (nextState) => {
      stateChanges.push(nextState.mode)
    })

    expect(term.options.cursorStyle).toBe('block')
    expect(term.options.cursorBlink).toBe(true)
    expect(refresh).toHaveBeenCalledWith(7, 7)
    expect(tracker.state).toEqual({
      mode: 'normal',
      shape: 'block',
      label: 'Normal',
      blink: false,
    })
    expect(stateChanges).toEqual(['normal'])
  })

  it('refreshes the active cursor row when applying a cursor state directly', () => {
    const refresh = vi.fn()
    const term: CliEditorCursorTerminal = {
      options: {
        cursorStyle: 'underline',
        cursorBlink: false,
      },
      buffer: {
        active: {
          cursorY: 3,
        },
      },
      refresh,
      write: () => undefined,
    }

    applyCliEditorCursorState(term, DEFAULT_CLI_EDITOR_CURSOR_STATE)

    expect(term.options.cursorStyle).toBe('block')
    expect(term.options.cursorBlink).toBe(true)
    expect(refresh).toHaveBeenCalledWith(3, 3)
  })
})
