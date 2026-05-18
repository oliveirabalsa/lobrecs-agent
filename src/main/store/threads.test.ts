import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, setDbForTests } from './db'
import { projectsStore } from './projects'
import { sessionsStore } from './sessions'
import { threadsStore } from './threads'

describe('threadsStore', () => {
  beforeEach(() => {
    setDbForTests(new Database(':memory:'))
  })

  afterEach(() => {
    closeDb()
    vi.useRealTimers()
  })

  it('creates threads and lists them newest-first within a project', () => {
    const project = createProject()
    const other = createProject('Other')

    const first = threadsStore.create({ projectId: project.id, title: 'First thread' })
    const second = threadsStore.create({ projectId: project.id, title: 'Second thread' })
    threadsStore.create({ projectId: other.id, title: 'Other project thread' })

    const list = threadsStore.list(project.id)
    expect(list.map((thread) => thread.id)).toEqual([second.id, first.id])
    expect(list.every((thread) => thread.projectId === project.id)).toBe(true)
    expect(first.pinned).toBe(false)
    expect(first.archivedAt).toBeUndefined()
  })

  it('hides archived threads by default and surfaces them when requested', () => {
    const project = createProject()
    const active = threadsStore.create({ projectId: project.id, title: 'Active' })
    const stale = threadsStore.create({ projectId: project.id, title: 'Stale' })

    const archived = threadsStore.archive(stale.id)
    expect(archived.archivedAt).toBeGreaterThan(0)

    expect(threadsStore.list(project.id).map((thread) => thread.id)).toEqual([active.id])
    expect(
      threadsStore
        .list(project.id, { includeArchived: true })
        .map((thread) => thread.id)
        .sort(),
    ).toEqual([active.id, stale.id].sort())
  })

  it('sorts pinned threads ahead of unpinned regardless of updated_at', () => {
    const project = createProject()
    const old = threadsStore.create({ projectId: project.id, title: 'Old' })
    const fresh = threadsStore.create({ projectId: project.id, title: 'Fresh' })

    threadsStore.pin(old.id, true)
    const list = threadsStore.list(project.id)

    expect(list[0]?.id).toBe(old.id)
    expect(list[1]?.id).toBe(fresh.id)
  })

  it('renames and unarchives threads', () => {
    const project = createProject()
    const thread = threadsStore.create({ projectId: project.id, title: 'Old name' })

    const renamed = threadsStore.rename(thread.id, 'New name')
    expect(renamed.title).toBe('New name')

    threadsStore.archive(thread.id)
    const restored = threadsStore.unarchive(thread.id)
    expect(restored.archivedAt).toBeUndefined()
  })

  it('linkSession bumps last_session_id and updated_at', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const project = createProject()
    const thread = threadsStore.create({ projectId: project.id, title: 'Live' })

    vi.setSystemTime(5_000)
    const linked = threadsStore.linkSession(thread.id, 'session-xyz')
    expect(linked.lastSessionId).toBe('session-xyz')
    expect(linked.updatedAt).toBe(5_000)
  })

  it('backfillFromSessions creates one thread per orphan session and links them', () => {
    const project = createProject()
    const a = sessionsStore.create({
      projectId: project.id,
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      prompt: 'Refactor the storage layer to support threads',
      createdAt: 1_000,
    })
    const b = sessionsStore.create({
      projectId: project.id,
      agentId: 'codex',
      model: 'gpt-5.3-codex',
      prompt: '',
      createdAt: 2_000,
    })

    const created = threadsStore.backfillFromSessions()
    expect(created).toBe(2)

    // Idempotent: re-running creates zero new threads.
    expect(threadsStore.backfillFromSessions()).toBe(0)

    const threads = threadsStore.list(project.id, { includeArchived: true })
    expect(threads).toHaveLength(2)

    const aThreadId = sessionsStore.getThreadId(a.id)
    const bThreadId = sessionsStore.getThreadId(b.id)
    expect(aThreadId).toBeTruthy()
    expect(bThreadId).toBeTruthy()

    const aThread = threadsStore.get(aThreadId!)
    expect(aThread?.title).toBe('Refactor the storage layer to support threads')
    expect(aThread?.lastSessionId).toBe(a.id)

    const bThread = threadsStore.get(bThreadId!)
    expect(bThread?.title).toBe('Untitled thread')
    expect(bThread?.lastSessionId).toBe(b.id)
  })

  it('linkToThread persists the thread_id on the session', () => {
    const project = createProject()
    const thread = threadsStore.create({ projectId: project.id, title: 'Manual link' })
    const session = sessionsStore.create({
      projectId: project.id,
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      prompt: 'hello',
    })

    expect(sessionsStore.getThreadId(session.id)).toBeNull()

    sessionsStore.linkToThread(session.id, thread.id)
    expect(sessionsStore.getThreadId(session.id)).toBe(thread.id)
  })

  it('create with empty title falls back to "Untitled thread"', () => {
    const project = createProject()
    const thread = threadsStore.create({ projectId: project.id, title: '   ' })
    expect(thread.title).toBe('Untitled thread')
  })

  it('delete hard-removes the thread without touching sessions', () => {
    const project = createProject()
    const thread = threadsStore.create({ projectId: project.id, title: 'Throwaway' })
    const session = sessionsStore.create({
      projectId: project.id,
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      prompt: 'preserve me',
      threadId: thread.id,
    })

    threadsStore.delete(thread.id)
    expect(threadsStore.get(thread.id)).toBeNull()
    // Session row keeps its orphaned thread_id reference.
    expect(sessionsStore.getThreadId(session.id)).toBe(thread.id)
    expect(sessionsStore.get(session.id)).not.toBeNull()
  })

  it('searches openable threads across projects, prompts, and messages', () => {
    const alpha = createProject('Alpha')
    const beta = createProject('Beta')
    const alphaThread = threadsStore.create({ projectId: alpha.id, title: 'Search palette' })
    const betaThread = threadsStore.create({ projectId: beta.id, title: 'Other work' })
    const archivedThread = threadsStore.create({ projectId: alpha.id, title: 'Archived diff' })

    const alphaSession = createSession(alpha.id, alphaThread.id, 'wire command palette')
    const betaSession = createSession(beta.id, betaThread.id, 'fix stale state')
    const archivedSession = createSession(alpha.id, archivedThread.id, 'diff viewer')

    threadsStore.linkSession(alphaThread.id, alphaSession.id)
    threadsStore.linkSession(betaThread.id, betaSession.id)
    threadsStore.linkSession(archivedThread.id, archivedSession.id)
    threadsStore.archive(archivedThread.id)
    addAssistantMessage(betaSession.id, 'The diff result is ready to review')

    expect(threadsStore.search({ query: 'palette' }).map((result) => result.thread.id)).toEqual([
      alphaThread.id,
    ])

    const messageMatch = threadsStore.search({ query: 'diff' })
    expect(messageMatch.map((result) => result.thread.id)).toEqual([betaThread.id])
    expect(messageMatch[0]).toMatchObject({
      project: { id: beta.id, name: 'Beta' },
      sessionId: betaSession.id,
      matchKind: 'message',
    })

    expect(
      threadsStore
        .search({ query: 'diff', includeArchived: true })
        .map((result) => result.thread.id),
    ).toEqual([archivedThread.id, betaThread.id])
  })
})

function createProject(name = 'Project') {
  return projectsStore.create({
    name,
    repoPath: `/repo/${name.toLowerCase()}`,
    agentId: 'claude-code',
    modelTier: 'balanced',
  })
}

function createSession(projectId: string, threadId: string, prompt: string) {
  return sessionsStore.create({
    projectId,
    threadId,
    agentId: 'claude-code',
    model: 'claude-sonnet-4-6',
    prompt,
    status: 'done',
  })
}

function addAssistantMessage(sessionId: string, text: string): void {
  sessionsStore.addEvent({
    type: 'activity',
    sessionId,
    payload: { kind: 'message', role: 'assistant', text },
    timestamp: Date.now(),
  })
}
