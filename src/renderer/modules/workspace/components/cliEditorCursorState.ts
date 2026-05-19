export type CliEditorCursorShape = 'block' | 'underline' | 'bar'
export type CliEditorCursorMode = 'normal' | 'replace' | 'insert'

export interface CliEditorCursorState {
  mode: CliEditorCursorMode
  shape: CliEditorCursorShape
  label: string
}

const CURSOR_ESCAPE_PATTERN = /\u001b\[(\d*) q/g
const CURSOR_ESCAPE_TAIL_LENGTH = 16

export const DEFAULT_CLI_EDITOR_CURSOR_STATE: CliEditorCursorState = {
  mode: 'normal',
  shape: 'block',
  label: 'Normal',
}

export function readCliEditorCursorStateChunk(
  previousTail: string,
  chunk: string,
): {
  remainder: string
  state?: CliEditorCursorState
} {
  const combined = `${previousTail}${chunk}`
  let state: CliEditorCursorState | undefined

  for (const match of combined.matchAll(CURSOR_ESCAPE_PATTERN)) {
    const rawParam = match[1] ?? ''
    const param = rawParam.trim() === '' ? 0 : Number(rawParam)
    const parsed = Number.isFinite(param) ? cursorStateFromParam(param) : null
    if (parsed) state = parsed
  }

  return {
    remainder: combined.slice(-CURSOR_ESCAPE_TAIL_LENGTH),
    state,
  }
}

export function cursorStyleForState(
  state: CliEditorCursorState,
): {
  cursorStyle: CliEditorCursorShape
  cursorBlink: true
} {
  // xterm.js v5 only repaints the cursor on its blink timer — a steady block
  // gets painted over by vim's screen redraws and disappears. Keep blink on so
  // the normal-mode block stays visible.
  return {
    cursorStyle: state.shape,
    cursorBlink: true,
  }
}

function cursorStateFromParam(param: number): CliEditorCursorState | null {
  switch (param) {
    case 0:
    case 1:
    case 2:
      return DEFAULT_CLI_EDITOR_CURSOR_STATE
    case 3:
    case 4:
      return {
        mode: 'replace',
        shape: 'underline',
        label: 'Replace',
      }
    case 5:
    case 6:
      return {
        mode: 'insert',
        shape: 'bar',
        label: 'Insert',
      }
    default:
      return null
  }
}
