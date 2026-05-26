import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionStatus } from '../../../../shared/types'
import { closeDb, setDbForTests } from '../../../store/db'
import { projectsStore } from '../../../store/projects'
import { sessionsStore } from '../../../store/sessions'
import {
  finishMultitaskPlanningSession,
  recordMultitaskSessionEvent,
} from './multitaskSessionEvents'

describe('multitaskSessionEvents', () => {
  beforeEach(() => {
    setDbForTests(new Database(':memory:'))
  })

  afterEach(() => {
    closeDb()
    vi.useRealTimers()
  })

  it('persists emitted multitask events so the renderer can replay the plan card', () => {
    const broadcast = vi.fn()
    const session = createMultitaskSession()
    const event = {
      type: 'activity' as const,
      sessionId: session.id,
      payload: {
        kind: 'multitask-plan' as const,
        planId: 'plan-1',
        tasks: [],
        totalEstimatedCostUsd: 0,
        decomposedBy: { agentId: 'codex' as const, model: 'gpt-5.5' },
        originalPrompt: 'Split this work',
      },
      timestamp: 1_000,
    }

    recordMultitaskSessionEvent(event, broadcast)

    expect(sessionsStore.listEvents(session.id)).toEqual([event])
    expect(broadcast).toHaveBeenCalledWith(event)
  })

  it('finishes the awaiting-input planner session after the multitask decision', () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000)
    const broadcast = vi.fn()
    const session = createMultitaskSession('awaiting-input')

    finishMultitaskPlanningSession(session.id, 'done', broadcast)

    expect(sessionsStore.get(session.id)?.status).toBe('done')
    expect(sessionsStore.get(session.id)?.completedAt).toBe(5_000)
    const completeEvent = {
      type: 'session-complete' as const,
      sessionId: session.id,
      payload: { status: 'done' },
      timestamp: 5_000,
    }
    expect(sessionsStore.listEvents(session.id).at(-1)).toEqual(completeEvent)
    expect(broadcast).toHaveBeenCalledWith(completeEvent)
  })
})

function createMultitaskSession(status: SessionStatus = 'running') {
  const project = projectsStore.create({
    id: 'project-1',
    name: 'Project',
    repoPath: '/repo',
    agentId: 'codex',
    modelTier: 'balanced',
  })

  return sessionsStore.create({
    id: 'session-1',
    projectId: project.id,
    agentId: 'opencode',
    model: 'multitask-decomposer',
    prompt: 'Split this work',
    status,
  })
}
