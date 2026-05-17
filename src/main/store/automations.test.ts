import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { automationsStore } from './automations'
import { closeDb, setDbForTests } from './db'
import { projectsStore } from './projects'

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
})

function createProject() {
  return projectsStore.create({
    name: 'Automation project',
    repoPath: '/repo/automation',
    agentId: 'claude-code',
    modelTier: 'balanced',
  })
}
