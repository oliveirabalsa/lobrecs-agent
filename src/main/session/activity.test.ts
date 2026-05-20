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

  it('suppresses Claude SessionEnd hook warnings from timeline activities', () => {
    const activities = deriveActivityEvents({
      type: 'stderr',
      sessionId: 'session-1',
      payload: {
        text: 'SessionEnd hook [_R="${CLAUDE_PLUGIN_ROOT}"; node "$_R/scripts/bun-runner.js" "$_/scripts/worker-service.cjs" hook claude-code session-complete] failed: 1276 | || (${R} == "string" && ${E} && ${E} == +${E})\n',
      },
      timestamp: 1,
    })

    expect(activities).toEqual([])
  })

  it('suppresses Claude plugin worker ENOENT warnings from timeline activities', () => {
    const activities = deriveActivityEvents({
      type: 'stderr',
      sessionId: 'session-1',
      payload: {
        text:
          '1277 | || (${R} === "string" && ${E} && ${E} == +${E})\n' +
          'ENOENT: no such file or directory, lstat \'/private/var/folders/mock/T/agentforge-36c16d57-51de-48-c7312401\' path: "/private/var/folders/mock/T/agentforge-36c16d57-51de-48-c7312401", syscall: "lstat", errno: -2, code: "ENOENT" at cue (/Users/leonardooliveirabalsalobre/.claude/plugins/cache/thedotmack/claude-mem/10.6.2/scripts/worker-service.cjs:1281:35133)\n' +
          'Bun v1.3.6 (macOS arm64)',
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

  it('turns Codex AskUserQuestion tool calls into structured question prompts', () => {
    const activities = deriveActivityEvents({
      type: 'stdout',
      sessionId: 'session-1',
      payload: {
        type: 'item.completed',
        item: {
          type: 'function_call',
          name: 'AskUserQuestion',
          call_id: 'call-questions',
          arguments: JSON.stringify({
            questions: [
              {
                header: 'Scope',
                question: 'Which areas should I focus?',
                multiSelect: true,
                options: [
                  {
                    label: 'Sidebar entrances (Recommended)',
                    description: 'Animate project and thread rows.',
                  },
                  {
                    label: 'Message stream',
                    description: 'Animate new turns and artifacts.',
                  },
                ],
              },
            ],
          }),
        },
      },
      timestamp: 1,
    }).map((event) => event.payload)

    expect(activities).toEqual([
      expect.objectContaining({
        kind: 'user-question',
        promptId: 'user-question:call-questions',
        title: 'Scope',
        questions: [
          expect.objectContaining({
            id: 'question-1',
            header: 'Scope',
            question: 'Which areas should I focus?',
            multiSelect: true,
            options: [
              expect.objectContaining({
                id: 'question-1-option-1',
                label: 'Sidebar entrances (Recommended)',
              }),
              expect.objectContaining({
                id: 'question-1-option-2',
                label: 'Message stream',
              }),
            ],
          }),
        ],
      }),
    ])
  })

  it('turns Codex AskUserQuestion started items into structured question prompts', () => {
    const activities = deriveActivityEvents({
      type: 'stdout',
      sessionId: 'session-1',
      payload: {
        type: 'item.started',
        item: {
          type: 'function_call',
          name: 'AskUserQuestion',
          call_id: 'call-questions',
          arguments: {
            questions: [
              {
                header: 'Cursor style',
                question: 'How should the cursor behave?',
                options: [{ label: 'Always blink' }],
              },
            ],
          },
        },
      },
      timestamp: 1,
    }).map((event) => event.payload)

    expect(activities).toEqual([
      expect.objectContaining({
        kind: 'user-question',
        promptId: 'user-question:call-questions',
        title: 'Cursor style',
        questions: [
          expect.objectContaining({
            question: 'How should the cursor behave?',
            options: [
              expect.objectContaining({
                label: 'Always blink',
              }),
            ],
          }),
        ],
      }),
    ])
  })

  it('turns generic AskUserQuestion tool-call events into structured question prompts', () => {
    const activities = deriveActivityEvents({
      type: 'stdout',
      sessionId: 'session-1',
      payload: {
        type: 'tool_call',
        tool: 'AskUserQuestion',
        id: 'call-generic',
        input: {
          questions: [
            {
              question: 'Should I continue?',
              options: [{ label: 'Yes' }],
            },
          ],
        },
      },
      timestamp: 1,
    }).map((event) => event.payload)

    expect(activities).toEqual([
      expect.objectContaining({
        kind: 'user-question',
        promptId: 'user-question:call-generic',
        questions: [
          expect.objectContaining({
            question: 'Should I continue?',
          }),
        ],
      }),
    ])
  })

  it('normalizes nested AskUserQuestion function payloads and validates options', () => {
    const activities = deriveActivityEvents({
      type: 'stdout',
      sessionId: 'session-1',
      payload: {
        type: 'item.completed',
        item: {
          type: 'function_call',
          call_id: 'call-nested',
          function: {
            name: 'functions.AskUserQuestion',
            arguments: JSON.stringify({
              questions: [
                {
                  id: 'duplicate',
                  header: '  Editor  ',
                  question: 'Which editor?',
                  multi_select: true,
                  options: [
                    'Vim',
                    { id: 'same', label: 'Neovim', description: 'Modern vim' },
                    { id: 'same', label: 'Both' },
                    { label: '' },
                  ],
                },
                {
                  id: 'duplicate',
                  question: 'Where should it appear?',
                  options: [{ label: 'Terminal panel' }],
                },
              ],
            }),
          },
        },
      },
      timestamp: 1,
    }).map((event) => event.payload)

    expect(activities).toEqual([
      expect.objectContaining({
        kind: 'user-question',
        promptId: 'user-question:call-nested',
        title: 'Agent questions',
        questions: [
          expect.objectContaining({
            id: 'duplicate',
            header: 'Editor',
            multiSelect: true,
            options: [
              expect.objectContaining({ label: 'Vim' }),
              expect.objectContaining({ id: 'same', label: 'Neovim' }),
              expect.objectContaining({ id: 'same-2', label: 'Both' }),
            ],
          }),
          expect.objectContaining({
            id: 'duplicate-2',
            question: 'Where should it appear?',
          }),
        ],
      }),
    ])
  })

  it('suppresses Codex AskUserQuestion tool result placeholders', () => {
    const activities = deriveActivityEvents({
      type: 'stdout',
      sessionId: 'session-1',
      payload: {
        type: 'item.completed',
        item: {
          type: 'function_call_output',
          name: 'AskUserQuestion',
          output: 'Answer questions?',
        },
      },
      timestamp: 1,
    })

    expect(activities).toEqual([])
  })

  it('turns OpenCode JSON events into visible messages, tools, and usage', () => {
    const events: AgentEvent[] = [
      {
        type: 'stdout',
        sessionId: 'session-1',
        payload: {
          type: 'step_start',
          part: { type: 'step-start' },
        },
        timestamp: 1,
      },
      {
        type: 'stdout',
        sessionId: 'session-1',
        payload: {
          type: 'tool_use',
          part: {
            type: 'tool',
            tool: 'bash',
            state: {
              status: 'completed',
              input: { command: 'pwd' },
              output: '/repo\n',
              metadata: { exit: 0 },
            },
          },
        },
        timestamp: 2,
      },
      {
        type: 'stdout',
        sessionId: 'session-1',
        payload: {
          type: 'text',
          part: { type: 'text', text: 'OpenCode response' },
        },
        timestamp: 3,
      },
      {
        type: 'session-complete',
        sessionId: 'session-1',
        payload: {
          exitCode: 0,
          usage: { input_tokens: 8, output_tokens: 6 },
          cost_usd: 0.0002,
        },
        timestamp: 4,
      },
    ]

    const activities = events.flatMap(deriveActivityEvents).map((event) => event.payload)

    expect(activities).toEqual([
      expect.objectContaining({ kind: 'step', title: 'Thinking', status: 'running' }),
      expect.objectContaining({
        kind: 'tool-call',
        name: 'bash',
        input: { command: 'pwd' },
        status: 'done',
      }),
      expect.objectContaining({
        kind: 'tool-result',
        name: 'bash',
        output: '/repo\n',
        status: 'done',
      }),
      expect.objectContaining({
        kind: 'message',
        role: 'assistant',
        text: 'OpenCode response',
      }),
      expect.objectContaining({
        kind: 'completion',
        status: 'done',
        tokensIn: 8,
        tokensOut: 6,
        costUsd: 0.0002,
      }),
    ])
  })

  it('turns Antigravity stream JSON events into visible messages and tools', () => {
    const events: AgentEvent[] = [
      {
        type: 'stdout',
        sessionId: 'session-1',
        payload: { type: 'init' },
        timestamp: 1,
      },
      {
        type: 'stdout',
        sessionId: 'session-1',
        payload: {
          type: 'message',
          role: 'assistant',
          content: 'Antigravity response',
        },
        timestamp: 2,
      },
      {
        type: 'stdout',
        sessionId: 'session-1',
        payload: {
          type: 'tool_use',
          tool_name: 'shell',
          parameters: { command: 'rtk pwd' },
        },
        timestamp: 3,
      },
      {
        type: 'stdout',
        sessionId: 'session-1',
        payload: {
          type: 'tool_result',
          tool_name: 'shell',
          output: '/repo\n',
        },
        timestamp: 4,
      },
    ]

    const activities = events.flatMap(deriveActivityEvents).map((event) => event.payload)

    expect(activities).toEqual([
      expect.objectContaining({ kind: 'step', title: 'Antigravity ready', status: 'done' }),
      expect.objectContaining({
        kind: 'message',
        role: 'assistant',
        text: 'Antigravity response\n',
      }),
      expect.objectContaining({
        kind: 'tool-call',
        name: 'shell',
        input: { command: 'rtk pwd' },
        status: 'running',
      }),
      expect.objectContaining({
        kind: 'tool-result',
        name: 'shell',
        output: '/repo',
        status: 'done',
      }),
    ])
  })

  it('turns nested Antigravity tool parts into visible tool activities without stealing OpenCode events', () => {
    const events: AgentEvent[] = [
      {
        type: 'stdout',
        sessionId: 'session-1',
        payload: {
          type: 'tool_use',
          part: {
            functionCall: {
              name: 'shell',
              args: { command: 'rtk pwd' },
            },
          },
        },
        timestamp: 1,
      },
      {
        type: 'stdout',
        sessionId: 'session-1',
        payload: {
          type: 'tool_result',
          part: {
            functionResponse: {
              name: 'shell',
              response: { output: '/repo\n' },
            },
          },
        },
        timestamp: 2,
      },
      {
        type: 'stdout',
        sessionId: 'session-1',
        payload: {
          type: 'tool_use',
          part: {
            type: 'tool',
            tool: 'bash',
            state: {
              status: 'completed',
              input: { command: 'pwd' },
              output: '/repo\n',
              metadata: { exit: 0 },
            },
          },
        },
        timestamp: 3,
      },
    ]

    const activities = events.flatMap(deriveActivityEvents).map((event) => event.payload)

    expect(activities).toEqual([
      expect.objectContaining({
        kind: 'tool-call',
        name: 'shell',
        input: { command: 'rtk pwd' },
        status: 'running',
      }),
      expect.objectContaining({
        kind: 'tool-result',
        name: 'shell',
        output: '/repo',
        status: 'done',
      }),
      expect.objectContaining({
        kind: 'tool-call',
        name: 'bash',
        input: { command: 'pwd' },
        status: 'done',
      }),
      expect.objectContaining({
        kind: 'tool-result',
        name: 'bash',
        output: '/repo\n',
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
