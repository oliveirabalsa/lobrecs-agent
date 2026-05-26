import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { automationsStore } from './automations'
import { closeDb, setDbForTests } from './db'
import { projectsStore } from './projects'
import { sessionsStore } from './sessions'

describe('automationsStore', () => {
  beforeEach(() => {
    setDbForTests(new Database(':memory:'))
  })

  afterEach(() => {
    closeDb()
    vi.useRealTimers()
  })

  it('creates, lists, and filters enabled automations', () => {
    const project = createProject()
    const enabled = automationsStore.create({
      projectId: project.id,
      name: 'Weekday review',
      prompt: 'review outstanding work',
      schedule: '0 9 * * 1-5',
      agentId: 'claude-code',
      enabled: true,
      createdAt: 1_000,
    })
    const disabled = automationsStore.create({
      projectId: project.id,
      name: 'Paused',
      prompt: 'do not run',
      schedule: '0 * * * *',
      agentId: 'codex',
      enabled: false,
      createdAt: 2_000,
    })

    expect(automationsStore.list(project.id).map((automation) => automation.id)).toEqual([
      disabled.id,
      enabled.id,
    ])
    expect(automationsStore.listEnabled().map((automation) => automation.id)).toEqual([
      enabled.id,
    ])
    expect(enabled).toMatchObject({
      status: 'scheduled',
      reviewState: 'reviewed',
      hasUnreadRuns: false,
      unreadRunCount: 0,
    })
  })

  it('updates fields and marks a run timestamp', () => {
    vi.useFakeTimers()
    const project = createProject()
    const automation = automationsStore.create({
      projectId: project.id,
      name: 'Original',
      prompt: 'prompt',
      schedule: '0 9 * * *',
      agentId: 'claude-code',
      enabled: true,
    })

    const updated = automationsStore.update(automation.id, {
      name: 'Updated',
      schedule: '0 10 * * *',
      enabled: false,
    })
    vi.setSystemTime(9_000)
    const marked = automationsStore.markRun(automation.id)

    expect(updated).toMatchObject({
      name: 'Updated',
      schedule: '0 10 * * *',
      enabled: false,
    })
    expect(marked.lastRunAt).toBe(9_000)
  })

  it('persists automation run history and triage review state', () => {
    const project = createProject()
    const automation = automationsStore.create({
      projectId: project.id,
      name: 'Daily triage',
      prompt: 'check work',
      schedule: '0 9 * * *',
      agentId: 'claude-code',
      enabled: true,
      nextRunAt: 10_000,
    })
    sessionsStore.create({
      id: 'session-1',
      projectId: project.id,
      agentId: 'claude-code',
      model: 'sonnet',
      prompt: 'automation run',
    })

    const run = automationsStore.createRun({
      automationId: automation.id,
      projectId: project.id,
      sessionId: 'session-1',
      trigger: 'schedule',
      status: 'failed',
      error: 'verification failed',
      createdAt: 11_000,
      startedAt: 11_000,
      completedAt: 12_000,
    })
    const reconciled = automationsStore.reconcileTriageState(automation.id)

    expect(automationsStore.listRuns(project.id)).toMatchObject([
      {
        id: run.id,
        automationId: automation.id,
        sessionId: 'session-1',
        status: 'failed',
        unread: true,
        reviewState: 'unread',
        error: 'verification failed',
      },
    ])
    expect(reconciled).toMatchObject({
      reviewState: 'unread',
      hasUnreadRuns: true,
      unreadRunCount: 1,
    })

    automationsStore.markRunReviewed(run.id)
    expect(automationsStore.reconcileTriageState(automation.id)).toMatchObject({
      reviewState: 'reviewed',
      hasUnreadRuns: false,
      unreadRunCount: 0,
    })
  })
})

function createProject() {
  return projectsStore.create({
    name: 'Automation project',
    repoPath: '/repo/automation',
    agentId: 'claude-code',
    modelTier: 'balanced',
  })
}
