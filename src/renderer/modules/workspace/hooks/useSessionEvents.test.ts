import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../../../shared/types'
import { deriveSessionActivities } from './useSessionEvents'

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

  it('suppresses Claude SessionEnd cwd-deleted warning activities loaded from history', () => {
    const activities = deriveSessionActivities([
      stderrEvent(
        'session-1',
        'SessionEnd hook [matcher: claude-code session-complete] failed: error: The current working directory was deleted, cannot run hook.\n',
        1,
      ),
      {
        type: 'activity',
        sessionId: 'session-1',
        payload: {
          kind: 'step',
          title: 'Process warning',
          detail:
            'SessionEnd hook [matcher: claude-code session-complete] failed: error: The current working directory was deleted, cannot run hook.',
          status: 'error',
        },
        timestamp: 1.001,
      },
    ])

    expect(activities).toEqual([])
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
