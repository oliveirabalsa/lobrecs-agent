import type { ITerminalOptions } from 'xterm'

export type CliEditorCursorShape = 'block' | 'underline' | 'bar'
export type CliEditorCursorMode = 'normal' | 'replace' | 'insert'

export interface CliEditorCursorState {
  mode: CliEditorCursorMode
  shape: CliEditorCursorShape
  label: string
  blink?: boolean
}

export interface CliEditorCursorTracker {
  remainder: string
  state: CliEditorCursorState
}

export interface CliEditorCursorTerminal {
  write: (data: string, callback?: () => void) => void
  refresh?: (start: number, end: number) => void
  options: Pick<ITerminalOptions, 'cursorBlink' | 'cursorStyle'>
  buffer: {
    active: {
      cursorY: number
    }
  }
}

const CURSOR_ESCAPE_PATTERN = /\u001b\[(\d*) q/g
const CURSOR_ESCAPE_TAIL_LENGTH = 16

export const DEFAULT_CLI_EDITOR_CURSOR_STATE: CliEditorCursorState = {
  mode: 'normal',
  shape: 'block',
  label: 'Normal',
}

export function createCliEditorCursorTracker(
  initialState: CliEditorCursorState = DEFAULT_CLI_EDITOR_CURSOR_STATE,
): CliEditorCursorTracker {
  return {
    remainder: '',
    state: initialState,
  }
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
  cursorBlink: boolean
} {
  return {
    cursorStyle: state.shape,
    cursorBlink: state.blink ?? true,
  }
}

export function applyCliEditorCursorState(
  term: CliEditorCursorTerminal,
  state: CliEditorCursorState,
): void {
  const nextOptions = cursorStyleForState(state)
  term.options.cursorStyle = nextOptions.cursorStyle
  term.options.cursorBlink = nextOptions.cursorBlink

  const cursorY = term.buffer.active.cursorY
  if (Number.isFinite(cursorY)) {
    term.refresh?.(cursorY, cursorY)
  }
}

export function writeTerminalWithCursorState(
  term: CliEditorCursorTerminal,
  tracker: CliEditorCursorTracker,
  chunk: string,
  onStateChange?: (state: CliEditorCursorState) => void,
): void {
  const parsed = readCliEditorCursorStateChunk(tracker.remainder, chunk)
  const previousState = tracker.state
  const nextState = parsed.state ?? previousState

  tracker.remainder = parsed.remainder
  tracker.state = nextState

  if (parsed.state && !sameCursorState(previousState, parsed.state)) {
    onStateChange?.(parsed.state)
  }

  term.write(chunk, () => {
    if (!parsed.state) return
    applyCliEditorCursorState(term, nextState)
  })
}

function cursorStateFromParam(param: number): CliEditorCursorState | null {
  switch (param) {
    case 0:
    case 1:
      return {
        mode: 'normal',
        shape: 'block',
        label: 'Normal',
      }
    case 2:
      return {
        mode: 'normal',
        shape: 'block',
        label: 'Normal',
        blink: false,
      }
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

function sameCursorState(left: CliEditorCursorState, right: CliEditorCursorState): boolean {
  return left.mode === right.mode && left.shape === right.shape
}
