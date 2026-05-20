import Database from 'better-sqlite3'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, projectsStore, sessionsStore, setDbForTests } from '../../../store'
import {
  ProjectMemoryService,
  memoryFilePath,
} from './projectMemoryService'

describe('ProjectMemoryService', () => {
  let repoPath: string
  let service: ProjectMemoryService

  beforeEach(async () => {
    setDbForTests(new Database(':memory:'))
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobrecs-agent-memory-'))
    service = new ProjectMemoryService()
  })

  afterEach(async () => {
    await fs.rm(repoPath, { recursive: true, force: true })
    closeDb()
  })

  it('stores project knowledge in the target repository memory file', async () => {
    const project = createProject(repoPath)

    const entry = await service.save({
      projectId: project.id,
      kind: 'architecture',
      summary: 'Keep renderer filesystem access behind preload APIs.',
      details: 'Renderer modules must use window.agentforge for privileged operations.',
    })

    const raw = await fs.readFile(memoryFilePath(repoPath), 'utf-8')
    expect(raw).toContain('Keep renderer filesystem access behind preload APIs.')
    expect(await service.list(project.id)).toEqual([expect.objectContaining({ id: entry.id })])
  })

  it('deduplicates learned knowledge by kind and summary', async () => {
    const project = createProject(repoPath)

    await service.save({
      projectId: project.id,
      kind: 'workflow',
      summary: 'Run rtk npm test before handoff.',
    })
    await service.save({
      projectId: project.id,
      kind: 'workflow',
      summary: 'Run rtk npm test before handoff.',
      details: 'Use focused tests first, then the broader suite.',
    })

    const entries = await service.list(project.id)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      summary: 'Run rtk npm test before handoff.',
      details: 'Use focused tests first, then the broader suite.',
    })
  })

  it('adds project memory to future prompt context', async () => {
    const project = createProject(repoPath)
    await service.save({
      projectId: project.id,
      kind: 'preference',
      summary: 'Prefer minimal tabbed product surfaces over dense dashboards.',
    })

    const context = await service.buildPromptContext({
      repoPath,
      baseContext: 'AGENTS.md instructions',
    })

    expect(context).toContain('AGENTS.md instructions')
    expect(context).toContain('Project knowledge base (.lobrecs/memory.json):')
    expect(context).toContain(
      '- [preference] Prefer minimal tabbed product surfaces over dense dashboards.',
    )
  })

  it('learns from positive feedback notes but ignores failure notes', async () => {
    const project = createProject(repoPath)
    const successSession = sessionsStore.create({
      projectId: project.id,
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      prompt: 'Implement memory',
      status: 'done',
    })
    const failureSession = sessionsStore.create({
      projectId: project.id,
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      prompt: 'Broken attempt',
      status: 'error',
    })

    await service.learnFromFeedback(
      successSession.id,
      'success',
      'Next time, preserve the modular main/preload/renderer boundary.',
    )
    await service.learnFromFeedback(
      failureSession.id,
      'failure',
      'This failed and should not become guidance.',
    )

    const entries = await service.list(project.id)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: 'workflow',
      source: 'user-feedback',
      sourceSessionId: successSession.id,
      summary: 'Next time, preserve the modular main/preload/renderer boundary.',
    })
  })
})

function createProject(repoPath: string) {
  return projectsStore.create({
    name: 'Memory project',
    repoPath,
    agentId: 'claude-code',
    modelTier: 'balanced',
  })
}
