import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../shared/types'
import { deriveActivityEvents } from './activity'

describe('agent activity normalization', () => {
  it('turns Codex approval JSON into a structured approval activity', () => {
    const [activity] = deriveActivityEvents({
      type: 'approval-request',
      sessionId: 'session-1',
      payload: {
        type: 'approval_request',
        action: 'run-command',
        argv: ['exec', '--model', 'gpt-5.2-codex'],
        cwd: '/repo',
      },
      timestamp: 1,
    })

    expect(activity?.type).toBe('activity')
    expect(activity?.payload).toMatchObject({
      kind: 'approval',
      status: 'pending',
      request: {
        action: 'run-command',
        command: 'exec --model gpt-5.2-codex',
        cwd: '/repo',
        risk: 'medium',
      },
    })
  })

  it('turns stdout text and completion usage into timeline activities', () => {
    const stdout: AgentEvent = {
      type: 'stdout',
      sessionId: 'session-1',
      payload: { text: 'hello' },
      timestamp: 1,
    }
    const complete: AgentEvent = {
      type: 'session-complete',
      sessionId: 'session-1',
      payload: { exitCode: 0, usage: { input_tokens: 10, output_tokens: 20 } },
      timestamp: 2,
    }

    expect(deriveActivityEvents(stdout)[0]?.payload).toMatchObject({
      kind: 'message',
      text: 'hello',
    })
    expect(deriveActivityEvents(complete)[0]?.payload).toMatchObject({
      kind: 'completion',
      status: 'done',
      tokensIn: 10,
      tokensOut: 20,
    })
  })

  it('turns diff proposals into summary and file-change activities', () => {
    const activities = deriveActivityEvents({
      type: 'diff',
      sessionId: 'session-1',
      payload: [
        {
          filePath: '/repo/a.ts',
          originalContent: 'old\n',
          proposedContent: 'new\nnext\n',
          additions: 2,
          deletions: 1,
        },
      ],
      timestamp: 1,
    }).map((event) => event.payload)

    expect(activities).toEqual([
      expect.objectContaining({ kind: 'diff-summary', filesChanged: 1, additions: 2, deletions: 1 }),
      expect.objectContaining({ kind: 'file-change', filePath: '/repo/a.ts', status: 'pending' }),
    ])
  })
})
