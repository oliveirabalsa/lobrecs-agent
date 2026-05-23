import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, setDbForTests } from './db'
import { runAuditStore } from './runAudit'

describe('runAuditStore', () => {
  beforeEach(() => {
    setDbForTests(new Database(':memory:'))
  })

  afterEach(() => {
    closeDb()
  })

  it('persists and lists records for a session ordered by createdAt', () => {
    const first = runAuditStore.create({
      sessionId: 'session-1',
      threadId: 'thread-1',
      attempt: 0,
      phase: 'recipe-started',
      recipeId: 'build',
      recipeLabel: 'Build',
      command: 'rtk npm run build',
    })

    const second = runAuditStore.create({
      sessionId: 'session-1',
      threadId: 'thread-1',
      attempt: 0,
      phase: 'recipe-failed',
      recipeId: 'build',
      recipeLabel: 'Build',
      command: 'rtk npm run build',
      exitCode: 1,
      outputTail: 'Type error',
      changedFiles: ['src/app.ts'],
    })

    const records = runAuditStore.listForSession('session-1')
    expect(records).toHaveLength(2)
    expect(records[0].id).toBe(first.id)
    expect(records[1]).toMatchObject({
      id: second.id,
      phase: 'recipe-failed',
      exitCode: 1,
      changedFiles: ['src/app.ts'],
      outputTail: 'Type error',
    })
  })

  it('isolates records by sessionId', () => {
    runAuditStore.create({
      sessionId: 'session-1',
      attempt: 0,
      phase: 'gate-passed',
      finalStatus: 'passed',
      stopReason: 'passed',
    })
    runAuditStore.create({
      sessionId: 'session-2',
      attempt: 0,
      phase: 'gate-stopped',
      stopReason: 'max-attempts',
      finalStatus: 'failed',
    })

    expect(runAuditStore.listForSession('session-1')).toHaveLength(1)
    expect(runAuditStore.listForSession('session-2')).toHaveLength(1)
  })
})
