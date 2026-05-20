import {
  TERMINAL_COMMAND_STATUS_PREFIX,
  TERMINAL_COMMAND_STATUS_SUFFIX,
  type TerminalFailureContext,
} from '../../../../shared/types'

const DEFAULT_MAX_LINES = 120
const DEFAULT_MAX_CHARS = 12_000
const PROMPT_OUTPUT_MAX_CHARS = 8_000
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

export interface TerminalCommandStatus {
  exitCode: number
}

export interface TerminalCommandStatusExtraction {
  text: string
  statuses: TerminalCommandStatus[]
}

export class TerminalOutputBuffer {
  private chunks = ''
  private readonly maxLines: number
  private readonly maxChars: number

  constructor(options: { maxLines?: number; maxChars?: number } = {}) {
    this.maxLines = options.maxLines ?? DEFAULT_MAX_LINES
    this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  }

  append(text: string): void {
    if (!text) return

    this.chunks += text
    this.trim()
  }

  tail(): string {
    return this.chunks
  }

  private trim(): void {
    if (this.chunks.length > this.maxChars) {
      this.chunks = this.chunks.slice(-this.maxChars)
    }

    const lines = this.chunks.split(/\r?\n/)
    if (lines.length > this.maxLines) {
      this.chunks = lines.slice(-this.maxLines).join('\n')
    }
  }
}

export class ShellCommandTracker {
  private current = ''
  private lastSubmitted: string | undefined

  recordInput(data: string): string | undefined {
    let submitted: string | undefined

    for (const char of data) {
      if (char === '\r' || char === '\n') {
        submitted = this.submit()
        continue
      }

      if (char === '\u0003') {
        this.current = ''
        continue
      }

      if (char === '\u007f' || char === '\b') {
        this.current = this.current.slice(0, -1)
        continue
      }

      if (char >= ' ' && char !== '\u007f') {
        this.current += char
      }
    }

    return submitted
  }

  lastCommand(): string | undefined {
    return this.lastSubmitted
  }

  private submit(): string | undefined {
    const submitted = this.current.trim()
    this.current = ''
    if (!submitted) return undefined

    this.lastSubmitted = submitted
    return submitted
  }
}

export function extractTerminalCommandStatuses(
  data: string,
): TerminalCommandStatusExtraction {
  const statuses: TerminalCommandStatus[] = []
  let text = ''
  let offset = 0

  while (offset < data.length) {
    const start = data.indexOf(TERMINAL_COMMAND_STATUS_PREFIX, offset)
    if (start === -1) {
      text += data.slice(offset)
      break
    }

    text += data.slice(offset, start)
    const valueStart = start + TERMINAL_COMMAND_STATUS_PREFIX.length
    const valueEnd = data.indexOf(TERMINAL_COMMAND_STATUS_SUFFIX, valueStart)
    if (valueEnd === -1) {
      text += data.slice(start)
      break
    }

    const exitCode = Number(data.slice(valueStart, valueEnd))
    if (Number.isInteger(exitCode)) statuses.push({ exitCode })
    offset = valueEnd + TERMINAL_COMMAND_STATUS_SUFFIX.length
  }

  return { text, statuses }
}

export function buildTerminalFailureContext(input: {
  terminalSessionId: string
  repoPath: string
  editorId: string
  editorName: string
  command?: string
  exitCode: number
  signal?: number
  outputTail: string
  capturedAt?: number
}): TerminalFailureContext {
  return {
    terminalSessionId: input.terminalSessionId,
    repoPath: input.repoPath,
    editorId: input.editorId,
    editorName: input.editorName,
    command: input.command?.trim() || undefined,
    exitCode: input.exitCode,
    signal: input.signal,
    outputTail: cleanTerminalText(input.outputTail).slice(-PROMPT_OUTPUT_MAX_CHARS),
    capturedAt: input.capturedAt ?? Date.now(),
  }
}

export function createTerminalRemediationPrompt(context: TerminalFailureContext): string {
  const command = context.command ?? 'an interactive shell command'
  const signalLine = context.signal === undefined ? '' : `\nSignal: ${context.signal}`

  return [
    'A terminal command failed in this project. Diagnose the root cause, make the smallest safe fix, and run focused verification.',
    '',
    `Repository: ${context.repoPath}`,
    `Command: ${command}`,
    `Exit code: ${context.exitCode}${signalLine}`,
    '',
    'Recent terminal output:',
    '```text',
    context.outputTail.trim() || '(no terminal output captured)',
    '```',
  ].join('\n')
}

export function cleanTerminalText(text: string): string {
  return text.replace(ANSI_PATTERN, '').replace(/\r\n?/g, '\n')
}
