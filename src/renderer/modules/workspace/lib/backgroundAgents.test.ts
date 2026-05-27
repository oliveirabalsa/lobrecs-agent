import { describe, expect, it } from 'vitest'
import type { AgentEvent, Session } from '../../../../shared/types'
import {
  BACKGROUND_AGENT_PREVIEW_LIMIT,
  backgroundAgentEventsFromBulkRecord,
  backgroundAgentPreviewState,
  backgroundAgentStatusFromEvent,
  backgroundAgentWaitMessage,
  canStopBackgroundAgentSession,
  indexBackgroundAgentEvents,
  latestBackgroundAgentUserQuestion,
  latestBackgroundAgentSessions,
  mergeBackgroundAgentEventMaps,
  rememberBackgroundAgentEvent,
  shouldFlushBackgroundAgentEventImmediately,
  summarizeBackgroundAgentSessions,
  type BackgroundAgentSession,
} from './backgroundAgents'

describe('latestBackgroundAgentSessions', () => {
  it('returns only the latest spawned block for the active thread', () => {
    const sessions: Session[] = [
      makeSession('parent-1', 1),
      makeSession('old-worker', 2, { kind: 'swarm', role: 'old worker' }),
      makeSession('finalizer-1', 3),
      makeSession('worker-1', 4, { kind: 'swarm', role: 'api' }),
      makeSession('worker-2', 5, { kind: 'swarm', role: 'ui' }),
      makeSession('other-worker', 6, { kind: 'swarm', role: 'other' }, 'other-thread'),
      makeSession('finalizer-2', 7),
    ]

    expect(latestBackgroundAgentSessions(sessions, 'thread-1').map((s) => s.id)).toEqual([
      'worker-1',
      'worker-2',
    ])
  })

  it('returns an empty list when the thread has no spawned sessions', () => {
    expect(latestBackgroundAgentSessions([makeSession('parent', 1)], 'thread-1')).toEqual([])
  })
})

describe('summarizeBackgroundAgentSessions', () => {
  it('counts active, done, and failed background sessions', () => {
    expect(
      summarizeBackgroundAgentSessions([
        makeBackgroundSession('worker-1', 1, 'api'),
        makeBackgroundSession('worker-2', 2, 'ui', 'done'),
        makeBackgroundSession('worker-3', 3, 'qa', 'error'),
        makeBackgroundSession('worker-4', 4, 'needs input', 'awaiting-input'),
      ]),
    ).toEqual({
      total: 4,
      done: 1,
      active: 1,
      failed: 1,
    })
  })
})

describe('backgroundAgentPreviewState', () => {
  it('keeps the card compact by default and exposes the hidden count', () => {
    const sessions = Array.from({ length: BACKGROUND_AGENT_PREVIEW_LIMIT + 2 }, (_, index) =>
      makeBackgroundSession(`worker-${index + 1}`, index + 1, `Agent ${index + 1}`),
    )

    expect(backgroundAgentPreviewState(sessions, false)).toMatchObject({
      hiddenCount: 2,
      overLimit: true,
    })
    expect(backgroundAgentPreviewState(sessions, false).visibleSessions.map((session) => session.id)).toEqual([
      'worker-3',
      'worker-4',
      'worker-5',
      'worker-6',
    ])
  })

  it('shows every background agent once the preview is expanded', () => {
    const sessions = Array.from({ length: BACKGROUND_AGENT_PREVIEW_LIMIT + 1 }, (_, index) =>
      makeBackgroundSession(`worker-${index + 1}`, index + 1, `Agent ${index + 1}`),
    )

    expect(backgroundAgentPreviewState(sessions, true).visibleSessions.map((session) => session.id)).toEqual([
      'worker-1',
      'worker-2',
      'worker-3',
      'worker-4',
      'worker-5',
    ])
  })
})

describe('backgroundAgentWaitMessage', () => {
  it('summarizes completed agents and the remaining blockers without output text', () => {
    expect(
      backgroundAgentWaitMessage([
        makeBackgroundSession('worker-1', 1, 'Agent 1', 'done'),
        makeBackgroundSession('worker-2', 2, 'Agent 2'),
        makeBackgroundSession('worker-3', 3, 'Agent 3'),
      ]),
    ).toBe('Agent 1 done. Waiting for Agent 2 and Agent 3.')
  })

  it('returns null once every background agent is done', () => {
    expect(
      backgroundAgentWaitMessage([
        makeBackgroundSession('worker-1', 1, 'Agent 1', 'done'),
      ]),
    ).toBeNull()
  })

  it('does not treat an agent question as background work still running', () => {
    expect(
      backgroundAgentWaitMessage([
        makeBackgroundSession('worker-1', 1, 'Agent 1', 'awaiting-input'),
      ]),
    ).toBeNull()
  })
})

describe('latestBackgroundAgentUserQuestion', () => {
  it('surfaces the latest background-agent question for the main thread', () => {
    const workerOne = makeBackgroundSession('worker-1', 1, 'Agent 1', 'awaiting-input')
    const workerTwo = makeBackgroundSession('worker-2', 2, 'Agent 2', 'awaiting-input')
    const eventsBySession = new Map<string, AgentEvent[]>([
      [
        workerOne.id,
        [
          makeUserQuestionEvent(workerOne.id, 10, 'question-1', 'Use API A?'),
        ],
      ],
      [
        workerTwo.id,
        [
          makeUserQuestionEvent(workerTwo.id, 11, 'question-2', 'Use API B?'),
        ],
      ],
    ])

    expect(
      latestBackgroundAgentUserQuestion([workerOne, workerTwo], eventsBySession),
    ).toMatchObject({
      key: 'worker-2:user-question:question-2',
      session: { id: 'worker-2' },
      prompt: {
        promptId: 'user-question:question-2',
        questions: [{ question: 'Use API B?' }],
      },
    })
  })

  it('ignores stale questions from sessions that are no longer awaiting input', () => {
    const cancelledWorker = makeBackgroundSession('worker-1', 1, 'Agent 1', 'cancelled')
    const eventsBySession = new Map<string, AgentEvent[]>([
      [
        cancelledWorker.id,
        [
          makeUserQuestionEvent(cancelledWorker.id, 10, 'question-1', 'Use API A?'),
        ],
      ],
    ])

    expect(
      latestBackgroundAgentUserQuestion([cancelledWorker], eventsBySession),
    ).toBeNull()
  })
})

describe('backgroundAgentStatusFromEvent', () => {
  it('marks a background session as awaiting input when it asks a user question', () => {
    expect(
      backgroundAgentStatusFromEvent(
        makeUserQuestionEvent('worker-1', 10, 'question-1', 'Continue?'),
      ),
    ).toBe('awaiting-input')
  })
})

describe('background agent event hydration', () => {
  it('hydrates background session events from one bulk record', () => {
    const workerOne = makeBackgroundSession('worker-1', 1, 'Agent 1')
    const workerTwo = makeBackgroundSession('worker-2', 2, 'Agent 2')
    const workerOneEvent = makeStepEvent(workerOne.id, 10, 'one')
    const unrelatedEvent = makeStepEvent('unrelated', 11, 'other')

    expect(
      [...backgroundAgentEventsFromBulkRecord([workerOne, workerTwo], {
        [workerOne.id]: [workerOneEvent],
        unrelated: [unrelatedEvent],
      })],
    ).toEqual([
      [workerOne.id, [workerOneEvent]],
      [workerTwo.id, []],
    ])
  })

  it('preserves live-only events when a bulk hydration response is older', () => {
    const historicalEvent = makeStepEvent('worker-1', 10, 'loaded')
    const liveEvent = makeStepEvent('worker-1', 20, 'live')

    expect(
      mergeBackgroundAgentEventMaps(
        new Map([['worker-1', [historicalEvent]]]),
        new Map([['worker-1', [historicalEvent, liveEvent]]]),
        ['worker-1'],
      ).get('worker-1'),
    ).toEqual([historicalEvent, liveEvent])
  })
})

describe('background agent event dedupe', () => {
  it('uses per-session event-key sets to reject duplicate live events', () => {
    const event = makeStepEvent('worker-1', 10, 'same')
    const index = indexBackgroundAgentEvents(new Map([['worker-1', [event]]]))

    expect(rememberBackgroundAgentEvent(index, 'worker-1', event)).toBe(false)
    expect(
      rememberBackgroundAgentEvent(index, 'worker-1', makeStepEvent('worker-1', 11, 'next')),
    ).toBe(true)
    expect(index.get('worker-1')).toHaveLength(2)
  })
})

describe('shouldFlushBackgroundAgentEventImmediately', () => {
  it('flushes status-changing events immediately', () => {
    expect(
      shouldFlushBackgroundAgentEventImmediately(
        makeUserQuestionEvent('worker-1', 10, 'question-1', 'Continue?'),
      ),
    ).toBe(true)
    expect(
      shouldFlushBackgroundAgentEventImmediately({
        type: 'session-complete',
        sessionId: 'worker-1',
        timestamp: 11,
        payload: { status: 'done' },
      }),
    ).toBe(true)
  })

  it('does not immediately flush routine stream events', () => {
    expect(shouldFlushBackgroundAgentEventImmediately(makeStepEvent('worker-1', 10, 'running')))
      .toBe(false)
  })
})

describe('canStopBackgroundAgentSession', () => {
  it.each([
    ['running', true],
    ['awaiting-approval', true],
    ['awaiting-input', true],
    ['done', false],
    ['error', false],
    ['cancelled', false],
  ] as const)('returns %s => %s', (status, expected) => {
    expect(
      canStopBackgroundAgentSession(makeBackgroundSession('worker-1', 1, 'Agent 1', status)),
    ).toBe(expected)
  })
})

function makeSession(
  id: string,
  createdAt: number,
  spawnedAgent?: Session['spawnedAgent'],
  threadId = 'thread-1',
  status: Session['status'] = 'running',
): Session {
  return {
    id,
    projectId: 'project-1',
    threadId,
    agentId: 'codex',
    model: 'gpt-5.5',
    prompt: id,
    spawnedAgent,
    status,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    createdAt,
    completedAt: createdAt + 1,
  }
}

function makeBackgroundSession(
  id: string,
  createdAt: number,
  role: string,
  status: Session['status'] = 'running',
): BackgroundAgentSession {
  return makeSession(id, createdAt, { kind: 'swarm', role }, 'thread-1', status) as BackgroundAgentSession
}

function makeStepEvent(sessionId: string, timestamp: number, title: string): AgentEvent {
  return {
    type: 'activity',
    sessionId,
    timestamp,
    payload: {
      kind: 'step',
      title,
      status: 'running',
    },
  }
}

function makeUserQuestionEvent(
  sessionId: string,
  timestamp: number,
  callId: string,
  question: string,
): AgentEvent {
  return {
    type: 'activity',
    sessionId,
    timestamp,
    payload: {
      kind: 'tool-call',
      name: 'ask_user_question',
      status: 'running',
      input: {
        question,
      },
      callId,
    },
  }
}
