import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, setDbForTests } from './db'
import { projectsStore } from './projects'
import { sessionsStore } from './sessions'

describe('sessionsStore', () => {
  beforeEach(() => {
    setDbForTests(new Database(':memory:'))
  })

  afterEach(() => {
    closeDb()
    vi.useRealTimers()
  })

  it('creates sessions with running defaults and lists newest first', () => {
    const project = createProject()

    const first = sessionsStore.create({
      projectId: project.id,
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      prompt: 'first',
      createdAt: 1_000,
    })
    const second = sessionsStore.create({
      projectId: project.id,
      agentId: 'codex',
      model: 'gpt-5.2-codex',
      prompt: 'second',
      createdAt: 2_000,
    })

    expect(first).toMatchObject({
      status: 'running',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      completedAt: undefined,
    })
    expect(sessionsStore.list(project.id).map((session) => session.id)).toEqual([
      second.id,
      first.id,
    ])
  })

  it('updates terminal status timestamps and clears them for non-terminal states', () => {
    vi.useFakeTimers()
    const project = createProject()
    const session = sessionsStore.create({
      projectId: project.id,
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      prompt: 'status',
    })

    vi.setSystemTime(5_000)
    const done = sessionsStore.updateStatus(session.id, 'done')
    expect(done.completedAt).toBe(5_000)

    const running = sessionsStore.updateStatus(session.id, 'running')
    expect(running.completedAt).toBeUndefined()
  })

  it('updates usage and persists ordered events', () => {
    const project = createProject()
    const session = sessionsStore.create({
      projectId: project.id,
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      prompt: 'usage',
    })

    const updated = sessionsStore.updateUsage(session.id, 120, 80, 0.0042)
    sessionsStore.addEvent({
      type: 'stdout',
      sessionId: session.id,
      payload: { text: 'hello' },
      timestamp: 10,
    })
    sessionsStore.addEvent({
      type: 'session-complete',
      sessionId: session.id,
      payload: { exitCode: 0 },
      timestamp: 20,
    })

    expect(updated).toMatchObject({ tokensIn: 120, tokensOut: 80, costUsd: 0.0042 })
    expect(sessionsStore.listEvents(session.id)).toEqual([
      {
        type: 'stdout',
        sessionId: session.id,
        payload: { text: 'hello' },
        timestamp: 10,
      },
      {
        type: 'session-complete',
        sessionId: session.id,
        payload: { exitCode: 0 },
        timestamp: 20,
      },
    ])
  })

  it('returns the fork payload needed by history UI', () => {
    const project = createProject()
    const session = sessionsStore.create({
      projectId: project.id,
      agentId: 'opencode',
      model: 'minimax',
      prompt: 'fork me',
    })

    expect(sessionsStore.getForkPayload(session.id)).toEqual({
      prompt: 'fork me',
      agentId: 'opencode',
      model: 'minimax',
    })
  })
})

function createProject() {
  return projectsStore.create({
    name: 'Project',
    repoPath: '/repo/project',
    agentId: 'claude-code',
    modelTier: 'balanced',
  })
}
