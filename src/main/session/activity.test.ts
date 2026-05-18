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
        argv: ['exec', '--model', 'gpt-5.3-codex'],
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
        command: 'exec --model gpt-5.3-codex',
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
    expect(
      deriveActivityEvents({
        ...complete,
        payload: { status: 'cancelled' },
      })[0]?.payload,
    ).toMatchObject({
      kind: 'completion',
      status: 'cancelled',
    })
  })

  it('suppresses Claude SessionEnd cwd-deleted hook warnings from timeline activities', () => {
    const activities = deriveActivityEvents({
      type: 'stderr',
      sessionId: 'session-1',
      payload: {
        text: 'SessionEnd hook [matcher: claude-code session-complete] failed: error: The current working directory was deleted, cannot run hook.\n',
      },
      timestamp: 1,
    })

    expect(activities).toEqual([])
  })

  it('keeps real stderr as process warning activities', () => {
    const [activity] = deriveActivityEvents({
      type: 'stderr',
      sessionId: 'session-1',
      payload: { text: 'real CLI warning\n' },
      timestamp: 1,
    })

    expect(activity?.payload).toMatchObject({
      kind: 'step',
      title: 'Process warning',
      detail: 'real CLI warning',
      status: 'error',
    })
  })

  it('turns Codex lifecycle JSON into Codex-style timeline activities', () => {
    const events: AgentEvent[] = [
      {
        type: 'stdout',
        sessionId: 'session-1',
        payload: { type: 'thread.started' },
        timestamp: 1,
      },
      {
        type: 'stdout',
        sessionId: 'session-1',
        payload: { type: 'turn.started' },
        timestamp: 2,
      },
      {
        type: 'stdout',
        sessionId: 'session-1',
        payload: {
          type: 'item.completed',
          item: { type: 'agent_message', text: 'Implemented the fix.' },
        },
        timestamp: 3,
      },
      {
        type: 'stdout',
        sessionId: 'session-1',
        payload: {
          type: 'item.started',
          item: {
            type: 'command_execution',
            command: "/bin/zsh -lc 'rtk npm test'",
            status: 'in_progress',
          },
        },
        timestamp: 4,
      },
      {
        type: 'stdout',
        sessionId: 'session-1',
        payload: {
          type: 'item.completed',
          item: {
            type: 'command_execution',
            command: "/bin/zsh -lc 'rtk npm test'",
            aggregated_output: 'tests passed',
            exit_code: 0,
            status: 'completed',
          },
        },
        timestamp: 5,
      },
    ]

    const activities = events.flatMap(deriveActivityEvents).map((event) => event.payload)

    expect(activities).toEqual([
      expect.objectContaining({ kind: 'step', title: 'Thinking', status: 'running' }),
      expect.objectContaining({
        kind: 'message',
        role: 'assistant',
        text: 'Implemented the fix.',
      }),
      expect.objectContaining({
        kind: 'tool-call',
        name: 'shell',
        status: 'running',
      }),
      expect.objectContaining({
        kind: 'tool-call',
        name: 'shell',
        status: 'done',
      }),
      expect.objectContaining({
        kind: 'tool-result',
        name: 'shell',
        output: 'tests passed',
        status: 'done',
      }),
    ])
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
