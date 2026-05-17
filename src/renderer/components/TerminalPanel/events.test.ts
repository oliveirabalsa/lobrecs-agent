import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../../shared/types'
import {
  completionStatus,
  createTerminalEventHandler,
  textFromPayload,
} from './events'

describe('terminal event handling', () => {
  it('extracts readable text from Claude, Codex, and OpenCode payload shapes', () => {
    expect(
      textFromPayload({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'hello from claude' }],
        },
      }),
    ).toBe('hello from claude')

    expect(textFromPayload({ type: 'agent_message', message: 'hello from codex' })).toBe(
      'hello from codex\r\n',
    )
    expect(textFromPayload({ type: 'message', content: [{ text: 'hello from opencode' }] })).toBe(
      'hello from opencode',
    )
    expect(textFromPayload({ type: 'metadata', session_id: 'abc' })).toBe('')
  })

  it('marks Claude result errors as failed sessions', () => {
    expect(completionStatus({ type: 'result', subtype: 'error' })).toBe('error')
    expect(completionStatus({ exitCode: 1 })).toBe('error')
    expect(completionStatus({ exitCode: 0 })).toBe('done')
  })

  it('deduplicates replayed events without clearing visible output', () => {
    const writes: string[] = []
    const callbacks = {
      onDiffProposals: vi.fn(),
      onApprovalRequest: vi.fn(),
      onStatusChange: vi.fn(),
    }
    const handler = createTerminalEventHandler(
      { write: (message) => writes.push(message) },
      callbacks,
      new Set(),
    )
    const event: AgentEvent = {
      type: 'stdout',
      sessionId: 'session-1',
      payload: { text: 'first line\n' },
      timestamp: 1,
    }

    handler(event)
    handler(event)

    expect(writes).toEqual(['first line\n'])
    expect(callbacks.onStatusChange).not.toHaveBeenCalled()
  })

  it('prints completion text and status exactly once', () => {
    const writes: string[] = []
    const callbacks = {
      onDiffProposals: vi.fn(),
      onApprovalRequest: vi.fn(),
      onStatusChange: vi.fn(),
    }
    const handler = createTerminalEventHandler(
      { write: (message) => writes.push(message) },
      callbacks,
      new Set(),
    )
    const event: AgentEvent = {
      type: 'session-complete',
      sessionId: 'session-1',
      payload: { type: 'result', subtype: 'error', result: 'failed from cli' },
      timestamp: 2,
    }

    handler(event)
    handler(event)

    expect(writes.join('')).toContain('failed from cli')
    expect(writes.join('')).toContain('Session failed.')
    expect(callbacks.onStatusChange).toHaveBeenCalledOnce()
    expect(callbacks.onStatusChange).toHaveBeenCalledWith('error')
  })

  it('does not duplicate successful Claude result text after streamed text already arrived', () => {
    const writes: string[] = []
    const callbacks = {
      onDiffProposals: vi.fn(),
      onApprovalRequest: vi.fn(),
      onStatusChange: vi.fn(),
    }
    const handler = createTerminalEventHandler(
      { write: (message) => writes.push(message) },
      callbacks,
      new Set(),
    )

    handler({
      type: 'stdout',
      sessionId: 'session-1',
      payload: { text: 'ok' },
      timestamp: 1,
    })
    handler({
      type: 'session-complete',
      sessionId: 'session-1',
      payload: { type: 'result', subtype: 'success', result: 'ok', exitCode: 0 },
      timestamp: 2,
    })

    expect(writes.join('')).toBe('ok\r\nSession complete.\r\n')
    expect(callbacks.onStatusChange).toHaveBeenCalledWith('done')
  })
})
