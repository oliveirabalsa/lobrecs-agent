import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, setDbForTests } from './db'
import { feedbackStore } from './feedback'
import { projectsStore } from './projects'
import { sessionsStore } from './sessions'

describe('feedbackStore', () => {
  beforeEach(() => {
    setDbForTests(new Database(':memory:'))
  })

  afterEach(() => {
    closeDb()
  })

  it('saves feedback and replaces previous feedback for a session', () => {
    const { firstFailure } = createSessions()

    feedbackStore.save(firstFailure.id, 'partial', 'almost useful')
    const replaced = feedbackStore.save(firstFailure.id, 'failure', 'not useful')

    expect(replaced).toMatchObject({
      sessionId: firstFailure.id,
      outcome: 'failure',
      userNote: 'not useful',
    })
    expect(feedbackStore.get(firstFailure.id)).toMatchObject({
      outcome: 'failure',
      userNote: 'not useful',
    })
  })

  it('returns recent failures only, ordered by session recency', () => {
    const { project, firstFailure, success, newestFailure } = createSessions()

    feedbackStore.save(firstFailure.id, 'failure')
    feedbackStore.save(success.id, 'success')
    feedbackStore.save(newestFailure.id, 'failure')

    expect(feedbackStore.getRecentFailures(project.id).map((failure) => failure.sessionId)).toEqual(
      [newestFailure.id, firstFailure.id],
    )
    expect(feedbackStore.getRecentFailures(project.id, 1)).toHaveLength(1)
  })

  it('rejects unsupported outcomes before hitting SQLite constraints', () => {
    const { firstFailure } = createSessions()

    expect(() => feedbackStore.save(firstFailure.id, 'unknown' as never)).toThrow(
      'Unsupported feedback outcome',
    )
  })
})

function createSessions() {
  const project = projectsStore.create({
    name: 'Feedback project',
    repoPath: '/repo/feedback',
    agentId: 'claude-code',
    modelTier: 'balanced',
  })

  const firstFailure = sessionsStore.create({
    projectId: project.id,
    agentId: 'claude-code',
    model: 'claude-haiku-4-5-20251001',
    prompt: 'failed lightweight task',
    createdAt: 1_000,
  })
  const success = sessionsStore.create({
    projectId: project.id,
    agentId: 'claude-code',
    model: 'claude-sonnet-4-6',
    prompt: 'successful balanced task',
    createdAt: 2_000,
  })
  const newestFailure = sessionsStore.create({
    projectId: project.id,
    agentId: 'codex',
    model: 'gpt-5.2-codex',
    prompt: 'newest failed task',
    createdAt: 3_000,
  })

  return { project, firstFailure, success, newestFailure }
}
