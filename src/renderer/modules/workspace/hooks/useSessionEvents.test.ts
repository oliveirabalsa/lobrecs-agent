import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../../../shared/types'
import {
  deriveSessionActivities,
  shouldReplayHistoricalSessionEvent,
} from './useSessionEvents'

describe('deriveSessionActivities', () => {
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
})

function stderrEvent(sessionId: string, text: string, timestamp: number): AgentEvent {
  return {
    type: 'stderr',
    sessionId,
    payload: { text },
    timestamp,
  }
}
