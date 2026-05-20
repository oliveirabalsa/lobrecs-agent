import { describe, expect, it, vi } from 'vitest'
import {
  TERMINAL_COMMAND_STATUS_PREFIX,
  TERMINAL_COMMAND_STATUS_SUFFIX,
} from '../../../../shared/types'
import {
  ShellCommandTracker,
  TerminalOutputBuffer,
  buildTerminalFailureContext,
  cleanTerminalText,
  createTerminalRemediationPrompt,
  extractTerminalCommandStatuses,
} from './terminalFailureCapture'

describe('TerminalOutputBuffer', () => {
  it('caps terminal output by line count and character count', () => {
    const buffer = new TerminalOutputBuffer({ maxLines: 3, maxChars: 20 })

    buffer.append('one\ntwo\nthree\nfour\nfive')

    expect(buffer.tail()).toBe('three\nfour\nfive')

    buffer.append('\n012345678901234567890')

    expect(buffer.tail().length).toBeLessThanOrEqual(20)
    expect(buffer.tail()).toContain('7890')
  })
})

describe('ShellCommandTracker', () => {
  it('tracks the most recent submitted shell command', () => {
    const tracker = new ShellCommandTracker()

    expect(tracker.recordInput('npm test')).toBeUndefined()
    expect(tracker.recordInput('\r')).toBe('npm test')
    expect(tracker.lastCommand()).toBe('npm test')
  })

  it('handles backspace and clears cancelled input', () => {
    const tracker = new ShellCommandTracker()

    tracker.recordInput('npm tset')
    tracker.recordInput('\u007f\u007f\u007fest')

    expect(tracker.recordInput('\r')).toBe('npm test')

    tracker.recordInput('rm -rf')
    tracker.recordInput('\u0003')

    expect(tracker.recordInput('\r')).toBeUndefined()
    expect(tracker.lastCommand()).toBe('npm test')
  })
})

describe('extractTerminalCommandStatuses', () => {
  it('removes command-status markers and returns exit codes', () => {
    const marker = `${TERMINAL_COMMAND_STATUS_PREFIX}1${TERMINAL_COMMAND_STATUS_SUFFIX}`

    expect(extractTerminalCommandStatuses(`failed\n${marker}next prompt`)).toEqual({
      text: 'failed\nnext prompt',
      statuses: [{ exitCode: 1 }],
    })
  })

  it('leaves incomplete markers in the visible text', () => {
    const partial = `${TERMINAL_COMMAND_STATUS_PREFIX}2`

    expect(extractTerminalCommandStatuses(`output${partial}`)).toEqual({
      text: `output${partial}`,
      statuses: [],
    })
  })
})

describe('terminal remediation prompt', () => {
  it('cleans ANSI sequences and includes failure context', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    const context = buildTerminalFailureContext({
      terminalSessionId: 'terminal-1',
      repoPath: '/tmp/repo',
      editorId: 'shell',
      editorName: 'Terminal',
      command: 'npm test',
      exitCode: 1,
      outputTail: '\u001b[31mFAIL\u001b[0m test failed\r\n',
    })

    expect(context).toMatchObject({
      capturedAt: 1_000,
      outputTail: 'FAIL test failed\n',
    })
    expect(createTerminalRemediationPrompt(context)).toContain('Command: npm test')
    expect(createTerminalRemediationPrompt(context)).toContain('FAIL test failed')

    vi.useRealTimers()
  })
})

describe('cleanTerminalText', () => {
  it('normalizes carriage returns and strips ANSI formatting', () => {
    expect(cleanTerminalText('\u001b[32mok\u001b[0m\r\nnext')).toBe('ok\nnext')
  })
})
