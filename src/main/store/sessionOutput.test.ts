import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../shared/types'
import { parseReviewerVerdict } from '../swarm/reviewVerdict'
import { extractSessionOutput, mergeSessionOutputFragments } from './sessionOutput'

describe('session output extraction', () => {
  it('coalesces streamed assistant chunks before reviewer verdict parsing', () => {
    const events: AgentEvent[] = [
      activityMessage('FEEDBACK:\n1. Fix the dropped context.\n', 1),
      activityMessage('2. Add the missing test.\n', 2),
      activityMessage('VERDICT: REJECTED', 3),
      {
        type: 'session-complete',
        sessionId: 'reviewer-session',
        payload: { status: 'done' },
        timestamp: 4,
      },
    ]

    const output = extractSessionOutput(events)

    expect(output).toContain('Fix the dropped context')
    expect(output).toContain('VERDICT: REJECTED')
    expect(parseReviewerVerdict(output).verdict).toBe('rejected')
  })

  it('dedupes cumulative snapshots emitted after streaming deltas', () => {
    expect(
      mergeSessionOutputFragments([
        'First sentence. ',
        'Second sentence.',
        'First sentence. Second sentence.',
      ]),
    ).toBe('First sentence. Second sentence.')
  })

  it('falls back to coalesced stdout when no assistant activity exists', () => {
    const events: AgentEvent[] = [
      stdoutText('Part one. ', 1),
      stdoutText('Part two.', 2),
    ]

    expect(extractSessionOutput(events)).toBe('Part one. Part two.')
  })
})

function activityMessage(text: string, timestamp: number): AgentEvent {
  return {
    type: 'activity',
    sessionId: 'reviewer-session',
    payload: {
      kind: 'message',
      role: 'assistant',
      text,
      stream: true,
    },
    timestamp,
  }
}

function stdoutText(text: string, timestamp: number): AgentEvent {
  return {
    type: 'stdout',
    sessionId: 'reviewer-session',
    payload: { text },
    timestamp,
  }
}
