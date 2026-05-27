import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, setDbForTests } from './db'
import { projectsStore } from './projects'
import { sessionsStore } from './sessions'
import { threadsStore } from './threads'

describe('sessionsStore', () => {
  beforeEach(() => {
    setDbForTests(new Database(':memory:'))
  })

  afterEach(() => {
    closeDb()
    vi.restoreAllMocks()
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
      model: 'gpt-5.3-codex',
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

  it('persists whether a session is a plan-mode planning turn', () => {
    const project = createProject()

    const session = sessionsStore.create({
      projectId: project.id,
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      prompt: 'plan first',
      planMode: true,
    })

    expect(session.planMode).toBe(true)
    expect(sessionsStore.get(session.id)?.planMode).toBe(true)
  })

  it('persists spawned-agent metadata for sidebar subagents', () => {
    const project = createProject()

    const session = sessionsStore.create({
      projectId: project.id,
      agentId: 'codex',
      model: 'gpt-5.3-codex',
      prompt: '[Role: implementer]\nBuild it',
      spawnedAgent: { kind: 'swarm', role: 'implementer' },
    })

    expect(session.spawnedAgent).toEqual({ kind: 'swarm', role: 'implementer' })
    expect(sessionsStore.get(session.id)?.spawnedAgent).toEqual({
      kind: 'swarm',
      role: 'implementer',
    })
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

  it('updates assistant summaries incrementally without reloading full event history', () => {
    const project = createProject()
    const session = sessionsStore.create({
      projectId: project.id,
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      prompt: 'streamed summary',
    })
    const listEventsSpy = vi.spyOn(sessionsStore, 'listEvents')

    addAssistantMessage(session.id, 'Now I ')
    addAssistantMessage(session.id, 'have the fix.')

    expect(sessionsStore.getAssistantSummary(session.id)).toBe('Now I have the fix.')

    sessionsStore.updateStatus(session.id, 'done', 100)

    expect(sessionsStore.getAssistantSummary(session.id)).toBe('Now I have the fix.')
    expect(listEventsSpy).not.toHaveBeenCalled()
  })

  it('coalesces cumulative assistant snapshots into the stored summary', () => {
    const project = createProject()
    const session = sessionsStore.create({
      projectId: project.id,
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      prompt: 'cumulative summary',
    })

    addAssistantMessage(session.id, 'Let me inspect ')
    addAssistantMessage(session.id, 'Let me inspect the session event flow.')
    addAssistantMessage(session.id, 'Let me inspect the session event flow.')

    expect(sessionsStore.getAssistantSummary(session.id)).toBe(
      'Let me inspect the session event flow.',
    )
  })

  it('keeps truncated assistant summaries stable after more streamed output arrives', () => {
    const project = createProject()
    const session = sessionsStore.create({
      projectId: project.id,
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      prompt: 'truncated summary',
    })

    addAssistantMessage(session.id, 'A'.repeat(6_100))
    const summaryAfterFirstChunk = sessionsStore.getAssistantSummary(session.id)

    addAssistantMessage(session.id, 'B'.repeat(50))

    expect(summaryAfterFirstChunk).toBeTruthy()
    expect(summaryAfterFirstChunk).toContain('[truncated]')
    expect(sessionsStore.getAssistantSummary(session.id)).toBe(summaryAfterFirstChunk)
  })

  it('backfills stdout output for terminal sessions that never emitted assistant messages', () => {
    const project = createProject()
    const session = sessionsStore.create({
      projectId: project.id,
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      prompt: 'stdout fallback',
    })

    sessionsStore.addEvent({
      type: 'stdout',
      sessionId: session.id,
      payload: { text: 'Part one. ' },
      timestamp: 1,
    })
    sessionsStore.addEvent({
      type: 'stdout',
      sessionId: session.id,
      payload: { text: 'Part two.' },
      timestamp: 2,
    })

    sessionsStore.updateStatus(session.id, 'done', 3)

    expect(sessionsStore.getAssistantSummary(session.id)).toBe('Part one. Part two.')
  })

  it('cancels interrupted active sessions without touching terminal history', () => {
    vi.useFakeTimers()
    const project = createProject()
    const running = sessionsStore.create({
      projectId: project.id,
      agentId: 'codex',
      model: 'gpt-5.5',
      prompt: 'running',
    })
    const waiting = sessionsStore.create({
      projectId: project.id,
      agentId: 'codex',
      model: 'gpt-5.5',
      prompt: 'waiting',
      status: 'awaiting-approval',
    })
    const done = sessionsStore.create({
      projectId: project.id,
      agentId: 'codex',
      model: 'gpt-5.5',
      prompt: 'done',
      status: 'done',
      completedAt: 1_000,
    })

    vi.setSystemTime(9_000)

    expect(sessionsStore.cancelInterrupted()).toBe(2)
    expect(sessionsStore.get(running.id)).toMatchObject({
      status: 'cancelled',
      completedAt: 9_000,
    })
    expect(sessionsStore.get(waiting.id)).toMatchObject({
      status: 'cancelled',
      completedAt: 9_000,
    })
    expect(sessionsStore.get(done.id)).toMatchObject({
      status: 'done',
      completedAt: 1_000,
    })
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

  it('maps the owning thread id onto session DTOs', () => {
    const project = createProject()
    const thread = threadsStore.create({ projectId: project.id, title: 'Follow-up thread' })
    const session = sessionsStore.create({
      projectId: project.id,
      threadId: thread.id,
      agentId: 'codex',
      model: 'gpt-5.3-codex',
      prompt: 'continue here',
    })

    expect(session.threadId).toBe(thread.id)
    expect(sessionsStore.get(session.id)?.threadId).toBe(thread.id)
    expect(sessionsStore.list(project.id)[0]?.threadId).toBe(thread.id)
  })

  it('lists sessions by thread in chronological order', () => {
    const project = createProject()
    const thread = threadsStore.create({ projectId: project.id, title: 'Test thread' })
    const otherThread = threadsStore.create({ projectId: project.id, title: 'Other thread' })

    const first = sessionsStore.create({
      projectId: project.id,
      threadId: thread.id,
      agentId: 'codex',
      model: 'gpt-5.3-codex',
      prompt: 'first',
      createdAt: 1_000,
    })
    const second = sessionsStore.create({
      projectId: project.id,
      threadId: thread.id,
      agentId: 'codex',
      model: 'gpt-5.3-codex',
      prompt: 'second',
      createdAt: 2_000,
    })
    const otherThreadSession = sessionsStore.create({
      projectId: project.id,
      threadId: otherThread.id,
      agentId: 'codex',
      model: 'gpt-5.3-codex',
      prompt: 'other',
      createdAt: 1_500,
    })

    expect(sessionsStore.listByThread(thread.id).map((s) => s.id)).toEqual([first.id, second.id])
    expect(sessionsStore.listByThread(otherThread.id).map((s) => s.id)).toEqual([
      otherThreadSession.id,
    ])
  })

  it('returns recent thread transcript turns in chronological order', () => {
    const project = createProject()
    const thread = threadsStore.create({ projectId: project.id, title: 'Follow-up thread' })

    const first = createThreadSession(thread.id, project.id, 'first prompt', 1_000, [
      {
        filePath: '/tmp/first.png',
        name: 'first.png',
        mimeType: 'image/png',
        size: 1_024,
      },
    ])
    const second = createThreadSession(thread.id, project.id, 'second prompt', 2_000)
    const third = createThreadSession(thread.id, project.id, 'third prompt', 3_000)
    const active = createThreadSession(thread.id, project.id, 'active prompt', 4_000)

    addAssistantMessage(first.id, 'first answer')
    addToolCall(first.id, 'git status')
    addFileChange(first.id, 'src/app.ts')
    addAssistantMessage(second.id, 'second answer')
    addAssistantMessage(third.id, 'third answer')
    addAssistantMessage(active.id, 'active answer')

    expect(sessionsStore.get(first.id)?.imageAttachments).toEqual([
      {
        filePath: '/tmp/first.png',
        name: 'first.png',
        mimeType: 'image/png',
        size: 1_024,
      },
    ])
    expect(
      sessionsStore
        .listThreadTranscript(thread.id, { limit: 3, excludeSessionId: active.id })
        .map((turn) => ({
          sessionId: turn.sessionId,
          prompt: turn.prompt,
          imageAttachments: turn.imageAttachments,
          events: turn.events.map((event) =>
            event.type === 'activity' && isRecord(event.payload)
              ? { type: event.type, kind: event.payload.kind }
              : { type: event.type },
          ),
          assistantText: turn.assistantText,
        })),
    ).toEqual([
      {
        sessionId: first.id,
        prompt: 'first prompt',
        imageAttachments: [
          {
            filePath: '/tmp/first.png',
            name: 'first.png',
            mimeType: 'image/png',
            size: 1_024,
          },
        ],
        events: [
          { type: 'activity', kind: 'message' },
          { type: 'activity', kind: 'tool-call' },
          { type: 'activity', kind: 'file-change' },
        ],
        assistantText: 'first answer',
      },
      {
        sessionId: second.id,
        prompt: 'second prompt',
        imageAttachments: undefined,
        events: [{ type: 'activity', kind: 'message' }],
        assistantText: 'second answer',
      },
      {
        sessionId: third.id,
        prompt: 'third prompt',
        imageAttachments: undefined,
        events: [{ type: 'activity', kind: 'message' }],
        assistantText: 'third answer',
      },
    ])
  })

  it('can exclude spawned background sessions from thread transcript turns', () => {
    const project = createProject()
    const thread = threadsStore.create({ projectId: project.id, title: 'Background thread' })

    const parent = createThreadSession(thread.id, project.id, 'parent prompt', 1_000)
    const worker = sessionsStore.create({
      projectId: project.id,
      threadId: thread.id,
      agentId: 'codex',
      model: 'gpt-5.3-codex',
      prompt: 'worker prompt',
      spawnedAgent: { kind: 'swarm', role: 'Worker 1' },
      status: 'done',
      createdAt: 2_000,
      completedAt: 2_100,
    })
    const finalizer = createThreadSession(thread.id, project.id, 'finalizer prompt', 3_000)

    expect(
      sessionsStore
        .listThreadTranscript(thread.id, { limit: 10, excludeSpawnedAgents: true })
        .map((turn) => turn.sessionId),
    ).toEqual([parent.id, finalizer.id])
    expect(
      sessionsStore
        .listThreadTranscript(thread.id, { limit: 10 })
        .map((turn) => turn.sessionId),
    ).toEqual([parent.id, worker.id, finalizer.id])
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

function createThreadSession(
  threadId: string,
  projectId: string,
  prompt: string,
  createdAt: number,
  imageAttachments?: Array<{
    filePath: string
    name?: string
    mimeType?: string
    size?: number
  }>,
) {
  return sessionsStore.create({
    projectId,
    threadId,
    agentId: 'claude-code',
    model: 'claude-sonnet-4-6',
    prompt,
    imageAttachments,
    status: 'done',
    createdAt,
    completedAt: createdAt + 100,
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

function addToolCall(sessionId: string, name: string): void {
  sessionsStore.addEvent({
    type: 'activity',
    sessionId,
    payload: { kind: 'tool-call', name, status: 'done' },
    timestamp: Date.now(),
  })
}

function addFileChange(sessionId: string, filePath: string): void {
  sessionsStore.addEvent({
    type: 'activity',
    sessionId,
    payload: {
      kind: 'file-change',
      filePath,
      changeType: 'modified',
      additions: 2,
      deletions: 1,
      status: 'applied',
    },
    timestamp: Date.now(),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
