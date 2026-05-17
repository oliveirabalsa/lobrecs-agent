import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { automationsStore } from './automations'
import { closeDb, setDbForTests } from './db'
import { feedbackStore } from './feedback'
import { projectsStore } from './projects'
import { sessionsStore } from './sessions'

describe('projectsStore', () => {
  beforeEach(() => {
    setDbForTests(new Database(':memory:'))
  })

  afterEach(() => {
    closeDb()
    vi.useRealTimers()
  })

  it('creates and lists projects by most recently updated first', () => {
    vi.useFakeTimers()

    vi.setSystemTime(1_000)
    const older = projectsStore.create({
      name: 'Older project',
      repoPath: '/repo/older',
      agentId: 'claude-code',
      modelTier: 'balanced',
    })

    vi.setSystemTime(2_000)
    const newer = projectsStore.create({
      name: 'Newer project',
      repoPath: '/repo/newer',
      agentId: 'codex',
      modelTier: 'advanced',
      context: 'project instructions',
    })

    expect(projectsStore.list().map((project) => project.id)).toEqual([newer.id, older.id])
    expect(projectsStore.getContext(newer.id)).toBe('project instructions')
  })

  it('updates project fields partially and refreshes updatedAt', () => {
    vi.useFakeTimers()

    vi.setSystemTime(1_000)
    const project = projectsStore.create({
      name: 'Initial',
      repoPath: '/repo/initial',
      agentId: 'claude-code',
      modelTier: 'balanced',
    })

    vi.setSystemTime(3_000)
    const updated = projectsStore.update(project.id, {
      name: 'Renamed',
      modelTier: 'frontier',
      context: 'new context',
    })

    expect(updated).toMatchObject({
      id: project.id,
      name: 'Renamed',
      repoPath: '/repo/initial',
      agentId: 'claude-code',
      modelTier: 'frontier',
      updatedAt: 3_000,
    })
    expect(projectsStore.getContext(project.id)).toBe('new context')
  })

  it('deletes related sessions, events, feedback, and automations via cascade', () => {
    const project = projectsStore.create({
      name: 'Cascade project',
      repoPath: '/repo/cascade',
      agentId: 'claude-code',
      modelTier: 'balanced',
    })
    const session = sessionsStore.create({
      projectId: project.id,
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      prompt: 'implement persistence',
    })

    sessionsStore.addEvent({
      type: 'stdout',
      sessionId: session.id,
      payload: { text: 'started' },
      timestamp: Date.now(),
    })
    feedbackStore.save(session.id, 'failure', 'needs another pass')
    const automation = automationsStore.create({
      projectId: project.id,
      name: 'Daily review',
      prompt: 'review open tasks',
      schedule: '0 9 * * 1-5',
      agentId: 'claude-code',
      enabled: true,
    })

    projectsStore.delete(project.id)

    expect(projectsStore.get(project.id)).toBeNull()
    expect(sessionsStore.list(project.id)).toEqual([])
    expect(sessionsStore.listEvents(session.id)).toEqual([])
    expect(feedbackStore.get(session.id)).toBeNull()
    expect(automationsStore.get(automation.id)).toBeNull()
  })
})
