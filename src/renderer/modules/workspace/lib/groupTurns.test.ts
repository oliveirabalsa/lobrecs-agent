import { describe, expect, it } from 'vitest'
import type { AgentActivity } from '../../../../shared/types'
import { groupTurns, normalizeAssistantMessages } from './groupTurns'

describe('groupTurns', () => {
  it('returns an empty array when there are no activities and no seed prompt', () => {
    expect(groupTurns([])).toEqual([])
  })

  it('emits a single synthetic turn for a seed user message with no activities', () => {
    const result = groupTurns([], {
      seedUserMessage: { text: 'hi there' },
      now: 1_000,
    })

    expect(result).toHaveLength(1)
    expect(result[0].userMessage).toEqual({ text: 'hi there' })
    expect(result[0].activities).toEqual([])
    expect(result[0].status).toBe('running')
  })

  it('uses the seed user message timestamp as the first turn start time', () => {
    const result = groupTurns(
      [
        { kind: 'message', role: 'assistant', text: 'working' },
        { kind: 'completion', status: 'done', summary: 'done' },
      ],
      {
        seedUserMessage: { text: 'do the thing', at: 123 },
        now: 10_000,
      },
    )

    expect(result[0].startedAt).toBe(123)
  })

  it('uses activity timestamps for completion duration without changing the seed start', () => {
    const result = groupTurns(
      [
        { kind: 'message', role: 'assistant', text: 'working' },
        { kind: 'completion', status: 'done', summary: 'done' },
      ],
      {
        seedUserMessage: { text: 'do the thing', at: 1_000 },
        activityTimes: [2_500, 8_500],
        now: 10_000,
      },
    )

    expect(result[0].startedAt).toBe(1_000)
    expect(result[0].endedAt).toBe(8_500)
  })

  it('uses the seed user message timestamp for an empty in-flight turn', () => {
    const result = groupTurns([], {
      seedUserMessage: { text: 'hi there', at: 456 },
      now: 1_000,
    })

    expect(result[0].startedAt).toBe(456)
  })

  it('preserves seed user image attachments for the rendered turn', () => {
    const result = groupTurns([], {
      seedUserMessage: {
        text: 'look at this',
        attachments: [
          {
            filePath: '/tmp/mock.png',
            name: 'mock.png',
            mimeType: 'image/png',
            size: 2_048,
          },
        ],
      },
      now: 1_000,
    })

    expect(result[0].userMessage?.attachments).toEqual([
      {
        filePath: '/tmp/mock.png',
        name: 'mock.png',
        mimeType: 'image/png',
        size: 2_048,
      },
    ])
  })

  it('groups activities up to a completion event and surfaces the final assistant message', () => {
    const activities: AgentActivity[] = [
      { kind: 'message', role: 'assistant', text: 'first chunk' },
      { kind: 'tool-call', name: 'bash', status: 'done' },
      { kind: 'message', role: 'assistant', text: 'final answer' },
      {
        kind: 'completion',
        status: 'done',
        summary: 'Session complete',
      },
    ]

    const result = groupTurns(activities, {
      seedUserMessage: { text: 'do the thing' },
      now: 5_000,
    })

    expect(result).toHaveLength(1)
    const [turn] = result
    expect(turn.userMessage).toEqual({ text: 'do the thing' })
    expect(turn.activities).toHaveLength(4)
    expect(turn.finalAssistantText).toBe('final answer')
    expect(turn.completion?.summary).toBe('Session complete')
    expect(turn.status).toBe('done')
    expect(turn.endedAt).toBeGreaterThan(turn.startedAt)
  })

  it('keeps post-completion review artifacts in the completed turn', () => {
    const activities: AgentActivity[] = [
      { kind: 'message', role: 'assistant', text: 'final answer' },
      { kind: 'completion', status: 'done', summary: 'Session complete' },
      {
        kind: 'diff-summary',
        filesChanged: 1,
        additions: 3,
        deletions: 1,
        summary: '1 file changed',
      },
      {
        kind: 'file-change',
        filePath: 'src/example.ts',
        changeType: 'modified',
        status: 'pending',
      },
    ]

    const result = groupTurns(activities, {
      seedUserMessage: { text: 'do the thing', at: 1_000 },
      activityTimes: [2_000, 7_000, 7_500, 7_501],
    })

    expect(result).toHaveLength(1)
    expect(result[0].completion?.summary).toBe('Session complete')
    expect(result[0].endedAt).toBe(7_000)
    expect(result[0].streamItems.map((item) => item.kind)).toEqual([
      'message',
      'completion',
      'diff-summary',
      'file-change',
    ])
  })

  it('keeps only the latest delegation card update on the parent turn', () => {
    const activities: AgentActivity[] = [
      { kind: 'message', role: 'assistant', text: 'delegating research' },
      {
        kind: 'delegation',
        delegationId: 'delegate-1',
        childSessionId: 'child-1',
        childThreadId: 'thread-1',
        goal: 'Research Hermes delegation',
        status: 'running',
        agentId: 'codex',
        model: 'gpt-5-codex',
      },
      { kind: 'completion', status: 'done', summary: 'Session complete' },
      {
        kind: 'delegation',
        delegationId: 'delegate-1',
        childSessionId: 'child-1',
        childThreadId: 'thread-1',
        goal: 'Research Hermes delegation',
        status: 'done',
        agentId: 'codex',
        model: 'gpt-5-codex',
        summary: 'Only final summaries return to the parent context.',
      },
    ]

    const result = groupTurns(activities, {
      seedUserMessage: { text: 'do the thing', at: 1_000 },
      activityTimes: [2_000, 3_000, 4_000, 5_000],
    })

    expect(result).toHaveLength(1)
    expect(result[0].streamItems.map((item) => item.kind)).toEqual([
      'message',
      'completion',
      'delegation',
    ])
    expect(result[0].streamItems.at(-1)).toMatchObject({
      kind: 'delegation',
      status: 'done',
      summary: 'Only final summaries return to the parent context.',
    })
  })

  it('splits multiple completions into separate turns', () => {
    const activities: AgentActivity[] = [
      { kind: 'message', role: 'assistant', text: 'turn 1' },
      { kind: 'completion', status: 'done', summary: 'first complete' },
      { kind: 'message', role: 'assistant', text: 'turn 2' },
      { kind: 'completion', status: 'done', summary: 'second complete' },
    ]

    const result = groupTurns(activities, { now: 0 })

    expect(result).toHaveLength(2)
    expect(result[0].finalAssistantText).toBe('turn 1')
    expect(result[0].completion?.summary).toBe('first complete')
    expect(result[1].finalAssistantText).toBe('turn 2')
    expect(result[1].completion?.summary).toBe('second complete')
    // The seed (when no seed provided) should not appear on later turns either.
    expect(result[0].userMessage).toBeUndefined()
    expect(result[1].userMessage).toBeUndefined()
  })

  it('only attaches the seed user message to the first turn', () => {
    const activities: AgentActivity[] = [
      { kind: 'completion', status: 'done', summary: 'first' },
      { kind: 'message', role: 'assistant', text: 'second' },
      { kind: 'completion', status: 'done', summary: 'second' },
    ]

    const result = groupTurns(activities, {
      seedUserMessage: { text: 'original prompt' },
    })

    expect(result).toHaveLength(2)
    expect(result[0].userMessage).toEqual({ text: 'original prompt' })
    expect(result[1].userMessage).toBeUndefined()
  })

  it('emits compaction as its own boundary turn between surrounding turns', () => {
    const activities: AgentActivity[] = [
      { kind: 'message', role: 'assistant', text: 'pre' },
      { kind: 'completion', status: 'done', summary: 'pre complete' },
      { kind: 'compaction', at: 12_345 },
      { kind: 'message', role: 'assistant', text: 'post' },
      { kind: 'completion', status: 'done', summary: 'post complete' },
    ]

    const result = groupTurns(activities)

    expect(result).toHaveLength(3)
    expect(result[1].activities).toHaveLength(1)
    expect(result[1].activities[0].kind).toBe('compaction')
    expect(result[1].status).toBe('done')
    expect(result[0].finalAssistantText).toBe('pre')
    expect(result[2].finalAssistantText).toBe('post')
  })

  it('closes the active turn before a mid-stream compaction event', () => {
    const activities: AgentActivity[] = [
      { kind: 'message', role: 'assistant', text: 'partial answer' },
      { kind: 'compaction', at: 99 },
      { kind: 'message', role: 'assistant', text: 'follow-up' },
      { kind: 'completion', status: 'done', summary: 'done' },
    ]

    const result = groupTurns(activities)

    // open turn → compaction turn → completed turn
    expect(result).toHaveLength(3)
    expect(result[0].activities).toHaveLength(1)
    expect(result[0].completion).toBeUndefined()
    expect(result[0].status).toBe('running')
    expect(result[1].activities[0].kind).toBe('compaction')
    expect(result[2].finalAssistantText).toBe('follow-up')
  })

  it('maps error completions to an error turn status', () => {
    const activities: AgentActivity[] = [
      { kind: 'message', role: 'assistant', text: 'attempted' },
      { kind: 'completion', status: 'error', summary: 'kaboom' },
    ]

    const result = groupTurns(activities)
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('error')
    expect(result[0].completion?.summary).toBe('kaboom')
  })

  it('leaves the final turn open (running) when no completion has arrived yet', () => {
    const activities: AgentActivity[] = [
      { kind: 'message', role: 'assistant', text: 'still going' },
      { kind: 'tool-call', name: 'bash', status: 'running' },
    ]

    const result = groupTurns(activities)
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('running')
    expect(result[0].completion).toBeUndefined()
    expect(result[0].endedAt).toBeUndefined()
  })

  it('keeps AskUserQuestion tool calls out of the ran-commands group', () => {
    const activities: AgentActivity[] = [
      {
        kind: 'tool-call',
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Where should the badge appear?',
              options: [{ label: 'Bottom terminal pane' }],
            },
          ],
        },
        status: 'running',
      },
      {
        kind: 'tool-call',
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Where should the badge appear?',
              options: [{ label: 'Bottom terminal pane' }],
            },
          ],
        },
        status: 'done',
      },
      {
        kind: 'tool-result',
        name: 'AskUserQuestion',
        output: 'Answer questions?',
        status: 'done',
      },
    ]

    const [turn] = groupTurns(activities)

    expect(turn.streamItems).toEqual([
      expect.objectContaining({
        kind: 'user-question',
        questions: [
          expect.objectContaining({
            question: 'Where should the badge appear?',
          }),
        ],
      }),
    ])
  })

  it('coalesces streamed assistant chunks before rendering the turn', () => {
    const [turn] = groupTurns([
      { kind: 'message', role: 'assistant', text: 'Now I ', stream: true },
      { kind: 'message', role: 'assistant', text: 'have the full picture.', stream: true },
    ])

    expect(turn.activities).toEqual([
      {
        kind: 'message',
        role: 'assistant',
        text: 'Now I have the full picture.',
        stream: true,
      },
    ])
  })

  it('coalesces repeated cumulative Claude stream snapshots', () => {
    const activities: AgentActivity[] = [
      { kind: 'message', role: 'assistant', text: 'Let me inspect ', stream: true },
      {
        kind: 'message',
        role: 'assistant',
        text: 'Let me inspect the session event flow.',
        stream: true,
      },
      {
        kind: 'message',
        role: 'assistant',
        text: 'Let me inspect the session event flow.',
        stream: true,
      },
    ]

    expect(normalizeAssistantMessages(activities)).toEqual([
      {
        kind: 'message',
        role: 'assistant',
        text: 'Let me inspect the session event flow.',
        stream: true,
      },
    ])
  })

  it('keeps true streamed deltas when they are not cumulative snapshots', () => {
    const activities: AgentActivity[] = [
      { kind: 'message', role: 'assistant', text: 'Now I ', stream: true },
      { kind: 'message', role: 'assistant', text: 'have the fix.', stream: true },
    ]

    expect(normalizeAssistantMessages(activities)).toEqual([
      {
        kind: 'message',
        role: 'assistant',
        text: 'Now I have the fix.',
        stream: true,
      },
    ])
  })

  it('drops exact duplicate assistant text sent after streaming completes', () => {
    const activities: AgentActivity[] = [
      { kind: 'message', role: 'assistant', text: 'Done.', stream: true },
      { kind: 'message', role: 'assistant', text: 'Done.' },
    ]

    expect(normalizeAssistantMessages(activities)).toEqual([
      { kind: 'message', role: 'assistant', text: 'Done.', stream: true },
    ])
  })

  it('suppresses re-emitted assistant text that was already shown before an intermediate activity', () => {
    // Reproduces the Codex item.completed duplication pattern:
    // streaming chunks → flushed on tool-call → item.completed re-emits the full text.
    // The fix uses a Set so the second emission is suppressed even though an
    // intermediate activity reset "last seen".
    const activities: AgentActivity[] = [
      { kind: 'message', role: 'assistant', text: 'Full response.', stream: true },
      { kind: 'tool-call', name: 'bash', status: 'done' },
      { kind: 'message', role: 'assistant', text: 'Full response.' },
    ]

    expect(normalizeAssistantMessages(activities)).toEqual([
      { kind: 'message', role: 'assistant', text: 'Full response.', stream: true },
      { kind: 'tool-call', name: 'bash', status: 'done' },
    ])
  })

  it('produces stable, unique turn ids', () => {
    const activities: AgentActivity[] = [
      { kind: 'completion', status: 'done', summary: 'a' },
      { kind: 'compaction', at: 1 },
      { kind: 'completion', status: 'done', summary: 'b' },
    ]

    const ids = groupTurns(activities).map((turn) => turn.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  describe('streamItems aggregation', () => {
    it('groups commands by type when consecutive', () => {
      const activities: AgentActivity[] = [
        { kind: 'command', command: 'ls', status: 'done' },
        { kind: 'command', command: 'pwd', status: 'done' },
        { kind: 'command', command: 'npm install', status: 'done' },
      ]

      const [turn] = groupTurns(activities)
      // ls and pwd are file-ops (grouped), npm install is package (singleton)
      expect(turn.streamItems).toHaveLength(2)
      expect(turn.streamItems[0].kind).toBe('ran-commands-group')
      expect(turn.streamItems[1].kind).toBe('command')
      if (turn.streamItems[0].kind === 'ran-commands-group') {
        expect(turn.streamItems[0].type).toBe('file-ops')
        expect(turn.streamItems[0].items).toHaveLength(2)
      }
    })

    it('groups tool-call + tool-result + command by type when consecutive', () => {
      const activities: AgentActivity[] = [
        { kind: 'tool-call', name: 'bash', status: 'running' },
        { kind: 'tool-result', name: 'bash', status: 'done', output: 'ok' },
        { kind: 'command', command: 'npm install', status: 'done' },
      ]

      const [turn] = groupTurns(activities)
      // bash tool-call/result are 'other' (grouped), npm is 'package' (singleton)
      expect(turn.streamItems).toHaveLength(2)
      expect(turn.streamItems[0].kind).toBe('ran-commands-group')
      expect(turn.streamItems[1].kind).toBe('command')
      if (turn.streamItems[0].kind === 'ran-commands-group') {
        expect(turn.streamItems[0].type).toBe('other')
        expect(turn.streamItems[0].items).toHaveLength(2)
      }
    })

    it('groups MCP tool traffic separately from generic tools', () => {
      const activities: AgentActivity[] = [
        {
          kind: 'tool-call',
          name: 'mcp__github__list_pull_requests',
          input: { repo: 'lobrecs-agent' },
          status: 'running',
        },
        {
          kind: 'tool-result',
          name: 'mcp__github__list_pull_requests',
          output: '[]',
          status: 'done',
        },
        { kind: 'tool-call', name: 'shell', status: 'running' },
      ]

      const [turn] = groupTurns(activities)

      expect(turn.streamItems.map((item) => item.kind)).toEqual([
        'mcp-calls-group',
        'tool-call',
      ])
      expect(turn.streamItems[0]).toMatchObject({
        kind: 'mcp-calls-group',
        items: [
          expect.objectContaining({ kind: 'tool-call' }),
          expect.objectContaining({ kind: 'tool-result' }),
        ],
      })
    })

    it('keeps a single command as a singleton (no group wrapper)', () => {
      const activities: AgentActivity[] = [
        { kind: 'command', command: 'pwd', status: 'done' },
      ]

      const [turn] = groupTurns(activities)
      expect(turn.streamItems).toHaveLength(1)
      expect(turn.streamItems[0].kind).toBe('command')
    })

    it('collapses 2 file-change activities within 5s into one edited-files-group', () => {
      const activities: AgentActivity[] = [
        { kind: 'file-change', filePath: 'a.ts', changeType: 'modified', status: 'pending' },
        { kind: 'file-change', filePath: 'b.ts', changeType: 'added', status: 'pending' },
      ]

      const [turn] = groupTurns(activities, {
        activityTimes: [1_000, 6_000],
      })
      expect(turn.streamItems).toHaveLength(1)
      const group = turn.streamItems[0]
      expect(group.kind).toBe('edited-files-group')
      if (group.kind === 'edited-files-group') {
        expect(group.items).toHaveLength(2)
      }
    })

    it('splits file-change activities 60s apart into two separate groups', () => {
      const activities: AgentActivity[] = [
        { kind: 'file-change', filePath: 'a.ts', changeType: 'modified', status: 'pending' },
        { kind: 'file-change', filePath: 'b.ts', changeType: 'modified', status: 'pending' },
      ]

      const [turn] = groupTurns(activities, {
        activityTimes: [1_000, 61_000],
      })
      // Two singletons, not a group
      expect(turn.streamItems).toHaveLength(2)
      expect(turn.streamItems[0].kind).toBe('file-change')
      expect(turn.streamItems[1].kind).toBe('file-change')
    })

    it('keeps a single file-change as a singleton', () => {
      const activities: AgentActivity[] = [
        { kind: 'file-change', filePath: 'only.ts', changeType: 'modified', status: 'pending' },
      ]

      const [turn] = groupTurns(activities)
      expect(turn.streamItems).toHaveLength(1)
      expect(turn.streamItems[0].kind).toBe('file-change')
    })

    it('renders namespaced patch tool calls as edited files instead of tools', () => {
      const activities: AgentActivity[] = [
        {
          kind: 'tool-call',
          name: 'functions.apply_patch',
          status: 'done',
          input: JSON.stringify({
            patch: [
              '*** Begin Patch',
              '*** Update File: src/example.ts',
              '@@',
              '-old line',
              '+new line',
              '*** End Patch',
            ].join('\n'),
          }),
        },
        {
          kind: 'tool-result',
          name: 'functions.apply_patch',
          status: 'done',
          output: 'Done!',
        },
      ]

      const [turn] = groupTurns(activities)

      expect(turn.streamItems).toEqual([
        expect.objectContaining({
          kind: 'file-change',
          filePath: 'src/example.ts',
          additions: 1,
          deletions: 1,
        }),
      ])
    })

    it('interleaves singletons + groups in order when activities mix kinds', () => {
      const activities: AgentActivity[] = [
        { kind: 'message', role: 'assistant', text: 'starting' },
        { kind: 'command', command: 'ls', status: 'done' },
        { kind: 'command', command: 'pwd', status: 'done' },
        { kind: 'message', role: 'assistant', text: 'mid' },
        { kind: 'file-change', filePath: 'a.ts', changeType: 'modified', status: 'pending' },
        { kind: 'file-change', filePath: 'b.ts', changeType: 'modified', status: 'pending' },
      ]

      const [turn] = groupTurns(activities)
      expect(turn.streamItems.map((s) => s.kind)).toEqual([
        'message',
        'ran-commands-group',
        'message',
        'edited-files-group',
      ])
    })
  })
})
