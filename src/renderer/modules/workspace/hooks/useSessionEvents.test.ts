import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../../../shared/types'
import {
  deriveSessionActivities,
  deriveTimedSessionActivities,
  latestHistoricalLiveDiffProposals,
  shouldReplayHistoricalSessionEvent,
} from './useSessionEvents'

describe('deriveSessionActivities', () => {
  it('keeps activity timestamps available for replayed message streams', () => {
    expect(
      deriveTimedSessionActivities([
        {
          type: 'activity',
          sessionId: 'session-1',
          payload: { kind: 'tool-call', name: 'git status', status: 'done' },
          timestamp: 10,
        },
        {
          type: 'session-complete',
          sessionId: 'session-1',
          payload: { status: 'done' },
          timestamp: 40,
        },
      ]),
    ).toEqual([
      {
        activity: { kind: 'tool-call', name: 'git status', status: 'done' },
        at: 10,
      },
      {
        activity: { kind: 'completion', status: 'done', summary: 'Session complete' },
        at: 40,
      },
    ])
  })

  it('uses explicit process warning activities instead of duplicating raw stderr', () => {
    const events: AgentEvent[] = [
      stderrEvent('session-1', 'same warning\n', 1),
      {
        type: 'activity',
        sessionId: 'session-1',
        payload: {
          kind: 'step',
          title: 'Process warning',
          detail: 'same warning',
          status: 'error',
        },
        timestamp: 1.001,
      },
    ]

    expect(
      deriveSessionActivities(events).filter(
        (activity) => activity.kind === 'step' && activity.title === 'Process warning',
      ),
    ).toHaveLength(1)
  })

  it('suppresses Claude SessionEnd hook warning activities loaded from history', () => {
    const activities = deriveSessionActivities([
      stderrEvent(
        'session-1',
        'SessionEnd hook [_R="${CLAUDE_PLUGIN_ROOT}"; node "$_R/scripts/bun-runner.js" "$_/scripts/worker-service.cjs" hook claude-code session-complete] failed: 1276 | || (${R} == "string" && ${E} && ${E} == +${E})\n',
        1,
      ),
      {
        type: 'activity',
        sessionId: 'session-1',
        payload: {
          kind: 'step',
          title: 'Process warning',
          detail:
            'SessionEnd hook [_R="${CLAUDE_PLUGIN_ROOT}"; node "$_R/scripts/bun-runner.js" "$_/scripts/worker-service.cjs" hook claude-code session-complete] failed: 1276 | || (${R} == "string" && ${E} && ${E} == +${E})',
          status: 'error',
        },
        timestamp: 1.001,
      },
    ])

    expect(activities).toEqual([])
  })

  it('suppresses Claude plugin worker ENOENT warning activities loaded from history', () => {
    const detail =
      '1277 | || (${R} === "string" && ${E} && ${E} == +${E})\n' +
      'ENOENT: no such file or directory, lstat \'/private/var/folders/mock/T/agentforge-36c16d57-51de-48-c7312401\' path: "/private/var/folders/mock/T/agentforge-36c16d57-51de-48-c7312401", syscall: "lstat", errno: -2, code: "ENOENT" at cue (/Users/example/.claude/plugins/cache/thedotmack/claude-mem/10.6.2/scripts/worker-service.cjs:1281:35133)\n' +
      'Bun v1.3.6 (macOS arm64)'
    const activities = deriveSessionActivities([
      stderrEvent('session-1', detail, 1),
      {
        type: 'activity',
        sessionId: 'session-1',
        payload: {
          kind: 'step',
          title: 'Process warning',
          detail,
          status: 'error',
        },
        timestamp: 1.001,
      },
    ])

    expect(activities).toEqual([])
  })

  it('turns persisted AskUserQuestion tool-call activities into question prompts', () => {
    const activities = deriveSessionActivities([
      {
        type: 'activity',
        sessionId: 'session-1',
        payload: {
          kind: 'tool-call',
          name: 'AskUserQuestion',
          input: {
            questions: [
              {
                header: 'Scope',
                question: 'Which area?',
                options: [{ label: 'Renderer' }],
              },
            ],
          },
          status: 'running',
        },
        timestamp: 1,
      },
      {
        type: 'activity',
        sessionId: 'session-1',
        payload: {
          kind: 'tool-call',
          name: 'AskUserQuestion',
          input: {
            questions: [
              {
                header: 'Scope',
                question: 'Which area?',
                options: [{ label: 'Renderer' }],
              },
            ],
          },
          status: 'done',
        },
        timestamp: 1.001,
      },
      {
        type: 'activity',
        sessionId: 'session-1',
        payload: {
          kind: 'tool-result',
          name: 'AskUserQuestion',
          output: 'Answer questions?',
          status: 'done',
        },
        timestamp: 1.002,
      },
    ])

    expect(activities).toEqual([
      expect.objectContaining({
        kind: 'user-question',
        promptId: expect.stringMatching(/^user-question:/),
        questions: [
          expect.objectContaining({
            header: 'Scope',
            question: 'Which area?',
            options: [expect.objectContaining({ label: 'Renderer' })],
          }),
        ],
      }),
    ])
  })

  it('does not replay persisted live diff snapshots as session history', () => {
    const historicalLiveDiff: AgentEvent = {
      type: 'diff',
      sessionId: 'session-1',
      payload: {
        live: true,
        proposals: [
          {
            filePath: '/repo/other-session.ts',
            originalContent: 'old\n',
            proposedContent: 'new\n',
          },
        ],
      },
      timestamp: 1,
    }
    const completionDiff: AgentEvent = {
      type: 'diff',
      sessionId: 'session-1',
      payload: [
        {
          filePath: '/repo/current-session.ts',
          originalContent: 'old\n',
          proposedContent: 'new\n',
        },
      ],
      timestamp: 2,
    }

    expect(shouldReplayHistoricalSessionEvent(historicalLiveDiff)).toBe(false)
    expect(shouldReplayHistoricalSessionEvent(completionDiff)).toBe(true)
    expect(deriveSessionActivities([historicalLiveDiff])).toEqual([])
  })

  it('restores the latest live diff snapshot when no completion diff superseded it', () => {
    const firstLiveDiff: AgentEvent = {
      type: 'diff',
      sessionId: 'session-1',
      payload: {
        live: true,
        proposals: [
          {
            filePath: '/repo/first.ts',
            originalContent: 'old\n',
            proposedContent: 'new\n',
          },
        ],
      },
      timestamp: 1,
    }
    const latestLiveDiff: AgentEvent = {
      type: 'diff',
      sessionId: 'session-1',
      payload: {
        live: true,
        proposals: [
          {
            filePath: '/repo/latest.ts',
            originalContent: 'before\n',
            proposedContent: 'after\n',
          },
        ],
      },
      timestamp: 2,
    }

    expect(latestHistoricalLiveDiffProposals([firstLiveDiff, latestLiveDiff])).toEqual([
      expect.objectContaining({
        filePath: '/repo/latest.ts',
        additions: 1,
        deletions: 1,
        status: 'pending',
      }),
    ])
  })

  it('does not restore live diff snapshots after a completion diff is available', () => {
    const liveDiff: AgentEvent = {
      type: 'diff',
      sessionId: 'session-1',
      payload: {
        live: true,
        proposals: [
          {
            filePath: '/repo/live.ts',
            originalContent: 'old\n',
            proposedContent: 'new\n',
          },
        ],
      },
      timestamp: 1,
    }
    const completionDiff: AgentEvent = {
      type: 'diff',
      sessionId: 'session-1',
      payload: [
        {
          filePath: '/repo/final.ts',
          originalContent: 'before\n',
          proposedContent: 'after\n',
        },
      ],
      timestamp: 2,
    }

    expect(latestHistoricalLiveDiffProposals([liveDiff, completionDiff])).toEqual([])
  })

  it('does not restore live diff snapshots after an empty completion diff is available', () => {
    const liveDiff: AgentEvent = {
      type: 'diff',
      sessionId: 'session-1',
      payload: {
        live: true,
        proposals: [
          {
            filePath: '/repo/live.ts',
            originalContent: 'old\n',
            proposedContent: 'new\n',
          },
        ],
      },
      timestamp: 1,
    }
    const emptyCompletionDiff: AgentEvent = {
      type: 'diff',
      sessionId: 'session-1',
      payload: [],
      timestamp: 2,
    }

    expect(latestHistoricalLiveDiffProposals([liveDiff, emptyCompletionDiff])).toEqual([])
  })
})

describe('bounded window derivation', () => {
  it('derives timed activities correctly for large event lists', () => {
    const events: AgentEvent[] = Array.from({ length: 200 }, (_, i) => ({
      type: 'activity',
      sessionId: 'session-1',
      payload: { kind: 'step', title: `Step ${i}`, status: 'done' as const },
      timestamp: i * 10,
    }))
    events.push({
      type: 'session-complete',
      sessionId: 'session-1',
      payload: { status: 'done' },
      timestamp: 2000,
    })

    const timedActivities = deriveTimedSessionActivities(events)
    expect(timedActivities).toHaveLength(201)
    expect(timedActivities[0].activity.kind).toBe('step')
    expect(timedActivities[timedActivities.length - 1].activity.kind).toBe('completion')
  })

  it('can window timed activities to the most recent N entries', () => {
    const events: AgentEvent[] = Array.from({ length: 150 }, (_, i) => ({
      type: 'activity',
      sessionId: 'session-1',
      payload: { kind: 'tool-call', name: `cmd-${i}`, status: 'done' as const },
      timestamp: i * 10,
    }))
    events.push({
      type: 'session-complete',
      sessionId: 'session-1',
      payload: { status: 'done' },
      timestamp: 1500,
    })

    const timedActivities = deriveTimedSessionActivities(events)
    const maxActivities = 120
    const bounded = timedActivities.length > maxActivities
      ? timedActivities.slice(timedActivities.length - maxActivities)
      : timedActivities

    expect(bounded).toHaveLength(120)
    expect(bounded[0].activity).toEqual({ kind: 'tool-call', name: 'cmd-31', status: 'done' })
    expect(bounded[bounded.length - 1].activity.kind).toBe('completion')
  })

  it('preserves pending prompts when using bounded window on recent activities', () => {
    const stepEvents: AgentEvent[] = Array.from({ length: 100 }, (_, i) => ({
      type: 'activity',
      sessionId: 'session-1',
      payload: { kind: 'step', title: `Step ${i}`, status: 'done' as const },
      timestamp: i * 10,
    } satisfies AgentEvent))
    const events: AgentEvent[] = [
      ...stepEvents,
      {
        type: 'activity',
        sessionId: 'session-1',
        payload: {
          kind: 'user-question',
          promptId: 'question-1',
          questions: [{ header: 'Test', question: 'Which option?', options: [] }],
        },
        timestamp: 1000,
      } satisfies AgentEvent,
    ]

    const timedActivities = deriveTimedSessionActivities(events)
    const maxActivities = 50
    const boundedTimedActivities = timedActivities.length > maxActivities
      ? timedActivities.slice(timedActivities.length - maxActivities)
      : timedActivities

    const lastActivity = boundedTimedActivities[boundedTimedActivities.length - 1]
    expect(lastActivity.activity.kind).toBe('user-question')
  })
})

function stderrEvent(sessionId: string, text: string, timestamp: number): AgentEvent {
  return {
    type: 'stderr',
    sessionId,
    payload: { text },
    timestamp,
  }
}
