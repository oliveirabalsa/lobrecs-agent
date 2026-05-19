import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, setDbForTests } from './db'
import { projectsStore } from './projects'
import { settingsStore } from './settings'

describe('settingsStore', () => {
  beforeEach(() => {
    setDbForTests(new Database(':memory:'))
  })

  afterEach(() => {
    closeDb()
    vi.useRealTimers()
  })

  it('persists global settings as normalized DTOs', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    const saved = settingsStore.saveGlobal({
      ui: { sidebarDefaultWidth: 999 },
      agents: { defaultAgentId: 'codex' },
    })

    expect(saved.ui.sidebarDefaultWidth).toBe(420)
    expect(saved.agents.defaultAgentId).toBe('codex')
    expect(settingsStore.getGlobal()).toMatchObject({
      ui: { sidebarDefaultWidth: 420 },
      agents: { defaultAgentId: 'codex' },
    })
  })

  it('persists project overrides and cascades on project deletion', () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000)
    const project = projectsStore.create({
      name: 'Settings project',
      repoPath: '/repo/settings',
      agentId: 'claude-code',
      modelTier: 'balanced',
    })

    const saved = settingsStore.saveProjectOverrides(project.id, {
      swarms: { maxAgents: 4 },
    })

    expect(saved).toMatchObject({
      projectId: project.id,
      updatedAt: 2_000,
      overrides: { swarms: { maxAgents: 4 } },
    })
    expect(settingsStore.getProjectOverrides(project.id)?.overrides).toMatchObject({
      swarms: { maxAgents: 4 },
    })

    projectsStore.delete(project.id)

    expect(settingsStore.getProjectOverrides(project.id)).toBeNull()
  })
})
