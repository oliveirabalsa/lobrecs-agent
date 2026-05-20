import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { buildProcessEnvironment, getUserShell } from '../../../process/environment'
import { detectEditors, type EditorInfo } from './detectEditors'
import type {
  CliEditorTerminalDataEvent,
  CliEditorTerminalExitEvent,
  CliEditorTerminalResizeInput,
  CliEditorTerminalSession,
  CliEditorTerminalStartInput,
  CliEditorTerminalWriteInput,
} from '../../../../shared/types'

export const CLI_EDITOR_TERMINAL_DATA_CHANNEL = 'system:cli-editor-terminal:data'
export const CLI_EDITOR_TERMINAL_EXIT_CHANNEL = 'system:cli-editor-terminal:exit'

const DEFAULT_COLS = 120
const DEFAULT_ROWS = 36
const MIN_COLS = 20
const MIN_ROWS = 5
const MAX_COLS = 500
const MAX_ROWS = 200
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{8,96}$/
// Classic Vim does not infer cursor-shape support from the embedded xterm.js PTY.
const VIM_CURSOR_SHAPE_COMMAND =
  'let &t_SI="\\e[6 q" | let &t_SR="\\e[4 q" | let &t_EI="\\e[1 q"'
/**
 * Reserved editorId that spawns the user's $SHELL interactively instead of
 * looking up a detected editor. Used by the "Terminal" entry in the Open-In
 * menu to give users a plain shell scoped to the project repo.
 */
export const SHELL_TERMINAL_EDITOR_ID = 'shell'
const SHELL_TERMINAL_NAME = 'Terminal'

export interface PtyProcessLike {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  onData(callback: (data: string) => void): DisposableLike | void
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): DisposableLike | void
}

export interface DisposableLike {
  dispose(): void
}

export interface PtySpawnOptions {
  name: string
  cols: number
  rows: number
  cwd: string
  env: NodeJS.ProcessEnv
}

export type PtySpawner = (
  command: string,
  args: string[],
  options: PtySpawnOptions,
) => PtyProcessLike

export type CliEditorTerminalEmitter = (
  channel:
    | typeof CLI_EDITOR_TERMINAL_DATA_CHANNEL
    | typeof CLI_EDITOR_TERMINAL_EXIT_CHANNEL,
  payload: CliEditorTerminalDataEvent | CliEditorTerminalExitEvent,
) => void

interface CliEditorTerminalServiceOptions {
  spawnPty: PtySpawner
  detectEditors?: () => Promise<EditorInfo[]>
}

interface ManagedCliEditorTerminal {
  session: CliEditorTerminalSession
  pty: PtyProcessLike
  dataSubscription?: DisposableLike
  exitSubscription?: DisposableLike
}

export class CliEditorTerminalService {
  private readonly spawnPty: PtySpawner
  private readonly detectEditors: () => Promise<EditorInfo[]>
  private readonly terminals = new Map<string, ManagedCliEditorTerminal>()

  constructor(options: CliEditorTerminalServiceOptions) {
    this.spawnPty = options.spawnPty
    this.detectEditors = options.detectEditors ?? detectEditors
  }

  async start(
    input: CliEditorTerminalStartInput,
    emit: CliEditorTerminalEmitter,
  ): Promise<CliEditorTerminalSession> {
    const sessionId = normalizeSessionId(input.sessionId)
    if (this.terminals.has(sessionId)) {
      throw new Error(`Terminal session already exists: ${sessionId}`)
    }

    const repoPath = path.resolve(input.repoPath)
    const userShell = getUserShell()
    const cols = clampDimension(input.cols, DEFAULT_COLS, MIN_COLS, MAX_COLS)
    const rows = clampDimension(input.rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS)

    const launch =
      input.editorId === SHELL_TERMINAL_EDITOR_ID
        ? { editorId: SHELL_TERMINAL_EDITOR_ID, editorName: SHELL_TERMINAL_NAME, command: userShell, args: ['-i', '-l'] }
        : await this.resolveEditorLaunch(input.editorId, userShell)

    const pty = this.spawnPty(launch.command, launch.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: repoPath,
      env: buildProcessEnvironment({
        SHELL: userShell,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      }),
    })

    const session: CliEditorTerminalSession = {
      sessionId,
      editorId: launch.editorId,
      editorName: launch.editorName,
      repoPath,
      command: launch.displayCommand ?? launch.command,
    }

    const managed: ManagedCliEditorTerminal = { session, pty }
    managed.dataSubscription = pty.onData((data) => {
      emit(CLI_EDITOR_TERMINAL_DATA_CHANNEL, { sessionId, data })
    }) ?? undefined
    managed.exitSubscription = pty.onExit((event) => {
      this.cleanup(sessionId)
      emit(CLI_EDITOR_TERMINAL_EXIT_CHANNEL, {
        sessionId,
        exitCode: event.exitCode,
        signal: event.signal,
      })
    }) ?? undefined

    this.terminals.set(sessionId, managed)
    return session
  }

  write(input: CliEditorTerminalWriteInput): void {
    this.terminals.get(input.sessionId)?.pty.write(input.data)
  }

  resize(input: CliEditorTerminalResizeInput): void {
    const terminal = this.terminals.get(input.sessionId)
    if (!terminal) return

    const cols = clampDimension(input.cols, DEFAULT_COLS, MIN_COLS, MAX_COLS)
    const rows = clampDimension(input.rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS)
    terminal.pty.resize(cols, rows)
  }

  stop(sessionId: string): void {
    this.terminals.get(sessionId)?.pty.kill()
  }

  stopAll(): void {
    for (const sessionId of [...this.terminals.keys()]) {
      this.stop(sessionId)
    }
  }

  has(sessionId: string): boolean {
    return this.terminals.has(sessionId)
  }

  private cleanup(sessionId: string): void {
    const terminal = this.terminals.get(sessionId)
    if (!terminal) return

    terminal.dataSubscription?.dispose()
    terminal.exitSubscription?.dispose()
    this.terminals.delete(sessionId)
  }

  private async resolveEditorLaunch(
    editorId: string,
    userShell: string,
  ): Promise<EditorLaunch> {
    const editors = await this.detectEditors()
    const editor = editors.find((entry) => entry.id === editorId)

    if (!editor) {
      throw new Error(`Editor not found: ${editorId}`)
    }

    if (editor.kind !== 'cli') {
      throw new Error(`${editor.name} is not a terminal editor`)
    }

    const editorCommand = buildCliEditorCommand(editor)
    return {
      editorId: editor.id,
      editorName: editor.name,
      command: userShell,
      args: ['-i', '-c', editorCommand.shellCommand],
      displayCommand: editorCommand.displayCommand,
    }
  }
}

interface EditorLaunch {
  editorId: string
  editorName: string
  command: string
  args: string[]
  displayCommand?: string
}

interface EditorCommand {
  shellCommand: string
  displayCommand: string
}

function buildCliEditorCommand(editor: EditorInfo): EditorCommand {
  const args = isClassicVimEditor(editor)
    ? ['--cmd', VIM_CURSOR_SHAPE_COMMAND, '.']
    : ['.']

  return {
    shellCommand: [editor.target, ...args].map(shellQuote).join(' '),
    displayCommand: [editor.target, '.'].map(shellQuote).join(' '),
  }
}

function isClassicVimEditor(editor: EditorInfo): boolean {
  return editor.id === 'vim' || path.basename(editor.target) === 'vim'
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value

  return `'${value.replace(/'/g, `'\\''`)}'`
}

function normalizeSessionId(sessionId: string | undefined): string {
  if (!sessionId) return randomUUID()

  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('Invalid terminal session id')
  }

  return sessionId
}

function clampDimension(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback

  return Math.min(max, Math.max(min, Math.floor(value)))
}
