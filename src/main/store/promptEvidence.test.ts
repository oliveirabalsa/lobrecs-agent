import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, setDbForTests } from './db'
import { projectsStore } from './projects'
import { promptEvidenceStore } from './promptEvidence'
import { sessionsStore } from './sessions'
import { threadsStore } from './threads'

describe('promptEvidenceStore', () => {
  beforeEach(() => {
    setDbForTests(new Database(':memory:'))
  })

  afterEach(() => {
    closeDb()
  })

  it('persists the resolved and final adapter context for a session', () => {
    const project = projectsStore.create({
      name: 'App',
      repoPath: '/tmp/app',
      agentId: 'codex',
      modelTier: 'balanced',
    })
    const thread = threadsStore.create({ projectId: project.id, title: 'Test' })
    const session = sessionsStore.create({
      projectId: project.id,
      threadId: thread.id,
      agentId: 'codex',
      model: 'gpt-5.1-codex',
      prompt: 'fix tests',
    })

    const record = promptEvidenceStore.create({
      sessionId: session.id,
      projectId: project.id,
      threadId: thread.id,
      agentId: 'codex',
      model: 'gpt-5.1-codex',
      prompt: 'fix tests',
      resolvedContext: 'Repository context\nFile: src/app.ts:1-3',
      adapterContext: 'Repository context\n\nConversation history',
    })

    expect(promptEvidenceStore.getForSession(session.id)).toMatchObject({
      id: record.id,
      sessionId: session.id,
      projectId: project.id,
      threadId: thread.id,
      agentId: 'codex',
      resolvedContext: 'Repository context\nFile: src/app.ts:1-3',
      adapterContext: 'Repository context\n\nConversation history',
      redacted: false,
    })
    expect(record.contextBytes).toBeGreaterThan(0)
  })

  it('redacts obvious secret assignments before storing context', () => {
    const project = projectsStore.create({
      name: 'App',
      repoPath: '/tmp/app',
      agentId: 'codex',
      modelTier: 'balanced',
    })
    const session = sessionsStore.create({
      projectId: project.id,
      agentId: 'codex',
      model: 'gpt-5.1-codex',
      prompt: 'inspect context',
    })

    promptEvidenceStore.create({
      sessionId: session.id,
      projectId: project.id,
      agentId: 'codex',
      model: 'gpt-5.1-codex',
      prompt: 'inspect context',
      resolvedContext: 'OPENAI_API_KEY=sk-secret\nUse rtk.',
    })

    expect(promptEvidenceStore.getForSession(session.id)).toMatchObject({
      resolvedContext: 'OPENAI_API_KEY=<redacted>\nUse rtk.',
      redacted: true,
    })
  })
})

