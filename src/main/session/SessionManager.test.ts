import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../shared/types'
import { worktreeManager } from '../git/WorktreeManager'
import { closeDb, projectsStore, sessionsStore, setDbForTests, threadsStore } from '../store'
import type { AgentAdapter, AgentSession } from './SessionManager'
import { SessionManager } from './SessionManager'
import { buildPlanExecutionPrompt } from './planModePrompt'

const execFileAsync = promisify(execFile)

describe('SessionManager', () => {
  let tempDirs: string[] = []

  beforeEach(() => {
    setDbForTests(new Database(':memory:'))
  })

  afterEach(async () => {
    await worktreeManager.removeAll().catch(() => undefined)
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
    tempDirs = []
    closeDb()
  })

  it('creates a session, broadcasts events, stores history, and captures usage on completion', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      estimateCost: (_model, tokensIn, tokensOut) => tokensIn / 1_000 + tokensOut / 500,
    })

    const { sessionId, threadId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'build store foundation',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      context: 'AGENTS.md',
    })

    expect(typeof threadId).toBe('string')
    expect(sessionsStore.getThreadId(sessionId)).toBe(threadId)
    expect(sessionsStore.get(sessionId)?.threadId).toBe(threadId)

    expect(adapter.dispatchedParams).toMatchObject({
      sessionId,
      prompt: 'build store foundation',
      repoPath: project.repoPath,
      model: 'claude-sonnet-4-6',
      context: 'AGENTS.md',
    })
    expect(sessionsStore.get(sessionId)).toMatchObject({ status: 'running' })
    expect(manager.isActive(sessionId)).toBe(true)

    adapter.emit({
      type: 'stdout',
      sessionId,
      payload: { text: 'working' },
      timestamp: 10,
    })
    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 0, usage: { input_tokens: 1_000, output_tokens: 500 } },
      timestamp: 20,
    })

    expect(broadcasts.map((event) => event.type)).toEqual([
      'stdout',
      'activity',
      'session-complete',
    ])
    expect(sessionsStore.listEvents(sessionId).map((event) => event.type)).toEqual([
      'stdout',
      'activity',
      'session-complete',
    ])
    expect(broadcasts.at(-1)?.payload).toMatchObject({ status: 'done' })
    expect(sessionsStore.get(sessionId)).toMatchObject({
      status: 'done',
      tokensIn: 1_000,
      tokensOut: 500,
      costUsd: 2,
    })
    expect(manager.isActive(sessionId)).toBe(false)
  })

  it('deduplicates identical process warning activities while preserving stderr events', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: () => undefined,
      worktreeIsolation: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'warn twice',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    const warning = { text: 'same CLI warning\n' }
    adapter.emit({ type: 'stderr', sessionId, payload: warning, timestamp: 10 })
    adapter.emit({ type: 'stderr', sessionId, payload: warning, timestamp: 11 })

    const events = sessionsStore.listEvents(sessionId)
    expect(events.filter((event) => event.type === 'stderr')).toHaveLength(2)
    expect(
      events.filter(
        (event) =>
          event.type === 'activity' &&
          typeof event.payload === 'object' &&
          event.payload !== null &&
          (event.payload as { title?: string }).title === 'Process warning',
      ),
    ).toHaveLength(1)
  })

  it('moves through approval state and delegates approval controls', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: () => undefined,
      worktreeIsolation: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'needs approval',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    adapter.emit({
      type: 'approval-request',
      sessionId,
      payload: { action: 'write-file', description: 'write file', details: 'file.ts' },
      timestamp: 10,
    })
    expect(sessionsStore.get(sessionId)?.status).toBe('awaiting-approval')
    expect(sessionsStore.listEvents(sessionId).map((event) => event.type)).toEqual([
      'activity',
      'approval-request',
    ])

    manager.approve(sessionId)

    expect(adapter.approve).toHaveBeenCalledTimes(1)
    expect(sessionsStore.get(sessionId)?.status).toBe('running')
  })

  it('pauses an active session when the agent asks the user a question', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'ask before editing',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    adapter.emit({
      type: 'stdout',
      sessionId,
      payload: {
        type: 'item.started',
        item: {
          type: 'function_call',
          name: 'AskUserQuestion',
          call_id: 'call-question',
          arguments: JSON.stringify({
            questions: [
              {
                header: 'Scope',
                question: 'Which files should I focus?',
                options: [{ label: 'Renderer only' }],
              },
            ],
          }),
        },
      },
      timestamp: 10,
    })

    expect(sessionsStore.get(sessionId)?.status).toBe('awaiting-input')
    expect(manager.isActive(sessionId)).toBe(false)
    expect(adapter.cancel).toHaveBeenCalledTimes(1)
    expect(
      sessionsStore.listEvents(sessionId).some(
        (event) =>
          event.type === 'activity' &&
          typeof event.payload === 'object' &&
          event.payload !== null &&
          (event.payload as { kind?: string }).kind === 'user-question',
      ),
    ).toBe(true)

    adapter.emit({
      type: 'stdout',
      sessionId,
      payload: { text: 'Skipping the question and choosing a default.' },
      timestamp: 11,
    })
    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 0 },
      timestamp: 12,
    })

    expect(sessionsStore.get(sessionId)?.status).toBe('awaiting-input')
    expect(
      sessionsStore
        .listEvents(sessionId)
        .some((event) => event.payload && JSON.stringify(event.payload).includes('Skipping')),
    ).toBe(false)
    expect(broadcasts.map((event) => event.type)).toEqual(['stdout', 'activity'])
  })

  it('links follow-up sessions to an existing thread id', async () => {
    const project = createProject()
    const thread = threadsStore.create({ projectId: project.id, title: 'Existing thread' })
    const adapter = new FakeAdapter()
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: () => undefined,
      worktreeIsolation: false,
    })

    const { sessionId, threadId } = await manager.dispatch({
      projectId: project.id,
      threadId: thread.id,
      prompt: 'follow up',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    expect(threadId).toBe(thread.id)
    expect(sessionsStore.get(sessionId)?.threadId).toBe(thread.id)
    expect(threadsStore.get(thread.id)?.lastSessionId).toBe(sessionId)
  })

  it('passes recent same-thread transcript into follow-up adapter context', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: () => undefined,
      worktreeIsolation: false,
    })

    const first = await manager.dispatch({
      projectId: project.id,
      prompt: 'build store foundation',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      context: 'AGENTS.md',
    })

    adapter.emit({
      type: 'stdout',
      sessionId: first.sessionId,
      payload: { text: 'Store foundation is ready' },
      timestamp: 10,
    })
    adapter.emit({
      type: 'session-complete',
      sessionId: first.sessionId,
      payload: { exitCode: 0 },
      timestamp: 20,
    })

    const followUp = await manager.dispatch({
      projectId: project.id,
      threadId: first.threadId,
      prompt: 'add focused tests',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      context: 'AGENTS.md',
    })

    expect(followUp.threadId).toBe(first.threadId)
    expect(sessionsStore.get(followUp.sessionId)?.threadId).toBe(first.threadId)

    const context = adapter.dispatches[1]?.context ?? ''
    expect(context.indexOf('AGENTS.md')).toBeLessThan(
      context.indexOf('Conversation history (same thread'),
    )
    expect(context).toContain('User: build store foundation')
    expect(context).toContain('Assistant: Store foundation is ready')
    expect(context).not.toContain('User: add focused tests')
    expect(adapter.dispatches[1]).toMatchObject({
      sessionId: followUp.sessionId,
      prompt: 'add focused tests',
      repoPath: project.repoPath,
      model: 'claude-sonnet-4-6',
    })
  })

  it('resolves project memory before appending same-thread transcript', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: () => undefined,
      worktreeIsolation: false,
      resolveContext: async ({ baseContext }) =>
        [
          baseContext?.trim(),
          'Project knowledge base (.lobrecs/memory.json):\n- [workflow] Use rtk for shell commands.',
        ]
          .filter(Boolean)
          .join('\n\n'),
    })

    const first = await manager.dispatch({
      projectId: project.id,
      prompt: 'build store foundation',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      context: 'AGENTS.md',
    })

    adapter.emit({
      type: 'stdout',
      sessionId: first.sessionId,
      payload: { text: 'Store foundation is ready' },
      timestamp: 10,
    })
    adapter.emit({
      type: 'session-complete',
      sessionId: first.sessionId,
      payload: { exitCode: 0 },
      timestamp: 20,
    })

    await manager.dispatch({
      projectId: project.id,
      threadId: first.threadId,
      prompt: 'add tests',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      context: 'AGENTS.md',
    })

    const context = adapter.dispatches[1]?.context ?? ''
    expect(context.indexOf('AGENTS.md')).toBeLessThan(
      context.indexOf('Project knowledge base'),
    )
    expect(context.indexOf('Project knowledge base')).toBeLessThan(
      context.indexOf('Conversation history'),
    )
    expect(context).toContain('- [workflow] Use rtk for shell commands.')
    expect(context).toContain('Assistant: Store foundation is ready')
  })

  it('allows overlapping local runs from different chat threads in the same repository', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: () => undefined,
      worktreeIsolation: false,
    })

    const first = await manager.dispatch({
      projectId: project.id,
      prompt: 'first chat',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    const second = await manager.dispatch({
      projectId: project.id,
      prompt: 'second chat',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    expect(manager.isActive(first.sessionId)).toBe(true)
    expect(manager.isActive(second.sessionId)).toBe(true)
    expect(first.threadId).not.toBe(second.threadId)
    expect(sessionsStore.get(first.sessionId)?.threadId).toBe(first.threadId)
    expect(sessionsStore.get(second.sessionId)?.threadId).toBe(second.threadId)
    expect(adapter.dispatches).toHaveLength(2)
  })

  it('allows overlapping local runs when they belong to the same chat thread', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: () => undefined,
      worktreeIsolation: false,
    })

    const first = await manager.dispatch({
      projectId: project.id,
      prompt: 'parallel implementer',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    const second = await manager.dispatch({
      projectId: project.id,
      threadId: first.threadId,
      prompt: 'parallel reviewer',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    expect(second.threadId).toBe(first.threadId)
    expect(adapter.dispatches).toHaveLength(2)
  })

  it('rejects stale thread ids before starting an agent process', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: () => undefined,
      worktreeIsolation: false,
    })

    await expect(
      manager.dispatch({
        projectId: project.id,
        threadId: 'missing-thread',
        prompt: 'follow up',
        agentId: 'claude-code',
        model: 'claude-sonnet-4-6',
        repoPath: project.repoPath,
      }),
    ).rejects.toThrow('Thread not found: missing-thread')

    expect(adapter.dispatchedParams).toBeNull()
  })

  it('cancels active sessions and broadcasts a synthetic completion', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'cancel me',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    manager.cancel(sessionId)

    expect(adapter.cancel).toHaveBeenCalledTimes(1)
    expect(sessionsStore.get(sessionId)?.status).toBe('cancelled')
    expect(manager.isActive(sessionId)).toBe(false)
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0]).toMatchObject({
      type: 'session-complete',
      sessionId,
      payload: { status: 'cancelled' },
    })
  })

  it('ignores late completion after cancellation', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'cancel then complete',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    manager.cancel(sessionId)
    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    expect(sessionsStore.get(sessionId)?.status).toBe('cancelled')
    // Only the synthetic cancel event is recorded; the late real completion
    // is dropped because the session is already in a terminal state.
    const recorded = sessionsStore.listEvents(sessionId)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      type: 'session-complete',
      payload: { status: 'cancelled' },
    })
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0]).toMatchObject({
      type: 'session-complete',
      payload: { status: 'cancelled' },
    })
  })

  it('marks sessions as error when no adapter is registered', async () => {
    const project = createProject()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })

    await expect(
      manager.dispatch({
        projectId: project.id,
        prompt: 'missing adapter',
        agentId: 'claude-code',
        model: 'claude-sonnet-4-6',
        repoPath: project.repoPath,
      }),
    ).rejects.toThrow('Adapter not found')

    const [session] = sessionsStore.list(project.id)
    expect(session.status).toBe('error')
    expect(broadcasts[0]).toMatchObject({ type: 'error', sessionId: session.id })
  })

  it('treats non-zero completion exit codes as errors', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: () => undefined,
      worktreeIsolation: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'will fail',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 1 },
      timestamp: 10,
    })

    expect(sessionsStore.get(sessionId)?.status).toBe('error')
    expect(sessionsStore.listEvents(sessionId).at(-1)?.payload).toMatchObject({
      status: 'error',
    })
  })

  it('emits review-only diff events for non-isolated local edits after completion', async () => {
    const repoPath = await createGitRepo(tempDirs)
    await fs.writeFile(path.join(repoPath, 'untouched.ts'), 'already dirty\n', 'utf-8')
    const project = createProject(repoPath)
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'edit locally',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    await fs.writeFile(path.join(repoPath, 'existing.ts'), 'updated locally\n', 'utf-8')
    await fs.writeFile(path.join(repoPath, 'created.ts'), 'created locally\n', 'utf-8')

    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    await waitFor(() => broadcasts.some((event) => event.type === 'session-complete'))

    const broadcastTypes = broadcasts.map((event) => event.type)
    expect(broadcastTypes.indexOf('diff')).toBeGreaterThanOrEqual(0)
    expect(broadcastTypes.indexOf('diff')).toBeLessThan(
      broadcastTypes.indexOf('session-complete'),
    )

    const diffEvent = broadcasts.find((event) => event.type === 'diff')
    const proposals = Array.isArray(diffEvent?.payload) ? diffEvent.payload : []
    expect(proposals.map((proposal) => path.basename(proposal.filePath)).sort()).toEqual([
      'created.ts',
      'existing.ts',
    ])
    expect(proposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: path.join(repoPath, 'created.ts'),
          originalContent: '',
          proposedContent: 'created locally\n',
          changeType: 'added',
          status: 'applied',
        }),
        expect.objectContaining({
          filePath: path.join(repoPath, 'existing.ts'),
          originalContent: 'original\n',
          proposedContent: 'updated locally\n',
          changeType: 'modified',
          status: 'applied',
        }),
      ]),
    )
    expect(
      sessionsStore.listEvents(sessionId).some(
        (event) =>
          event.type === 'activity' &&
          typeof event.payload === 'object' &&
          event.payload !== null &&
          (event.payload as { kind?: string }).kind === 'file-change',
      ),
    ).toBe(true)
  })

  it('records a diagnostic activity when local completion produces no diff proposals', async () => {
    const repoPath = await createGitRepo(tempDirs)
    const project = createProject(repoPath)
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'inspect without edits',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    await waitFor(() => broadcasts.some((event) => event.type === 'session-complete'))

    expect(broadcasts.map((event) => event.type)).not.toContain('diff')
    expect(
      broadcasts.some(
        (event) =>
          event.type === 'activity' &&
          typeof event.payload === 'object' &&
          event.payload !== null &&
          (event.payload as { title?: string }).title === 'No code changes detected',
      ),
    ).toBe(true)

    const storedTypes = sessionsStore.listEvents(sessionId).map((event) => event.type)
    expect(storedTypes.indexOf('activity')).toBeLessThan(
      storedTypes.indexOf('session-complete'),
    )
  })

  it('auto-applies worktree diffs before emitting review-only diff events', async () => {
    const repoPath = await createGitRepo(tempDirs)
    const project = createProject(repoPath)
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    let diffSawRegisteredWorktree = false
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => {
        if (event.type === 'diff') {
          diffSawRegisteredWorktree = worktreeManager.getPath(event.sessionId) !== undefined
        }
        broadcasts.push(event)
      },
      worktreeIsolation: true,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'change files',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    const worktreePath = adapter.dispatchedParams?.repoPath
    expect(worktreePath).toBeTruthy()
    await fs.writeFile(path.join(worktreePath ?? '', 'existing.ts'), 'updated\n', 'utf-8')
    await fs.writeFile(path.join(worktreePath ?? '', 'created.ts'), 'created\n', 'utf-8')

    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    await waitFor(() => broadcasts.some((event) => event.type === 'session-complete'))

    await expect(fs.readFile(path.join(repoPath, 'existing.ts'), 'utf-8')).resolves.toBe(
      'updated\n',
    )
    await expect(fs.readFile(path.join(repoPath, 'created.ts'), 'utf-8')).resolves.toBe(
      'created\n',
    )

    const broadcastTypes = broadcasts.map((event) => event.type)
    expect(broadcastTypes.filter((type) => type === 'session-complete')).toHaveLength(1)
    expect(broadcastTypes.indexOf('activity')).toBeLessThan(broadcastTypes.indexOf('diff'))
    expect(broadcastTypes.indexOf('diff')).toBeGreaterThanOrEqual(0)
    expect(broadcastTypes.indexOf('diff')).toBeLessThan(
      broadcastTypes.indexOf('session-complete'),
    )
    expect(diffSawRegisteredWorktree).toBe(true)
    expect(worktreeManager.getPath(sessionId)).toBeUndefined()

    const diffEvent = broadcasts.find((event) => event.type === 'diff')
    expect(diffEvent?.payload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: path.join(repoPath, 'created.ts'),
          originalContent: '',
          proposedContent: 'created\n',
          changeType: 'added',
          status: 'applied',
        }),
        expect.objectContaining({
          filePath: path.join(repoPath, 'existing.ts'),
          originalContent: 'original\n',
          proposedContent: 'updated\n',
          changeType: 'modified',
          status: 'applied',
        }),
      ]),
    )

    const storedTypes = sessionsStore.listEvents(sessionId).map((event) => event.type)
    expect(storedTypes.filter((type) => type === 'session-complete')).toHaveLength(1)
    expect(storedTypes.indexOf('diff')).toBeLessThan(storedTypes.indexOf('session-complete'))
  })

  it('runs the quality gate after applied diffs and before completion is emitted', async () => {
    const repoPath = await createGitRepo(tempDirs)
    const project = createProject(repoPath)
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const qualityGateRunner = vi.fn(async (input) => {
      input.emitActivity({
        kind: 'step',
        title: 'Automated QA passed',
        status: 'done',
      })
    })
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      qualityGateRunner,
      worktreeIsolation: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'edit locally',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    await fs.writeFile(path.join(repoPath, 'existing.ts'), 'updated with qa\n', 'utf-8')

    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    await waitFor(() => broadcasts.some((event) => event.type === 'session-complete'))

    expect(qualityGateRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        projectId: project.id,
        repoPath,
        attempt: 0,
        changedFiles: [
          expect.objectContaining({
            filePath: path.join(repoPath, 'existing.ts'),
            status: 'applied',
          }),
        ],
      }),
    )

    const qualityIndex = broadcasts.findIndex(
      (event) =>
        event.type === 'activity' &&
        typeof event.payload === 'object' &&
        event.payload !== null &&
        (event.payload as { title?: string }).title === 'Automated QA passed',
    )
    expect(qualityIndex).toBeGreaterThanOrEqual(0)
    expect(qualityIndex).toBeLessThan(
      broadcasts.findIndex((event) => event.type === 'session-complete'),
    )
  })

  it('keeps conflicted auto-apply changes as review-only conflicts without blocking completion', async () => {
    const repoPath = await createGitRepo(tempDirs)
    const project = createProject(repoPath)
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: true,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'change files',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    const worktreePath = adapter.dispatchedParams?.repoPath
    expect(worktreePath).toBeTruthy()
    await fs.writeFile(path.join(worktreePath ?? '', 'existing.ts'), 'agent edit\n', 'utf-8')
    await fs.writeFile(path.join(repoPath, 'existing.ts'), 'user edit\n', 'utf-8')

    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    await waitFor(() => broadcasts.some((event) => event.type === 'session-complete'))

    await expect(fs.readFile(path.join(repoPath, 'existing.ts'), 'utf-8')).resolves.toBe(
      'user edit\n',
    )
    expect(sessionsStore.get(sessionId)?.status).toBe('done')

    const diffEvent = broadcasts.find((event) => event.type === 'diff')
    expect(diffEvent?.payload).toEqual([
      expect.objectContaining({
        filePath: path.join(repoPath, 'existing.ts'),
        proposedContent: 'agent edit\n',
        status: 'conflict',
      }),
    ])
    expect(
      broadcasts.some(
        (event) =>
          event.type === 'activity' &&
          typeof event.payload === 'object' &&
          event.payload !== null &&
          (event.payload as { title?: string }).title ===
            'Some code changes could not be applied',
      ),
    ).toBe(true)
  })

  it('adds plan-mode instructions without turning the task into a plan request', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })

    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'add a settings page',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      planMode: true,
    })

    // The agent receives the real task as the task, while plan-mode rules live
    // in context. This avoids creating a plan for "create a plan".
    expect(adapter.dispatchedParams?.prompt).toBe('add a settings page')
    expect(adapter.dispatchedParams?.context).toContain('[Plan Mode]')
    expect(adapter.dispatchedParams?.context).toMatch(/actual work request/i)
    expect(adapter.dispatchedParams?.context).toMatch(
      /implementation plan itself/i,
    )
    // The stored session also keeps the original task text clean.
    expect(sessionsStore.get(sessionId)?.prompt).toBe('add a settings page')

    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    await waitFor(() =>
      broadcasts.some(
        (event) =>
          event.type === 'activity' &&
          (event.payload as { kind?: string }).kind === 'plan-review',
      ),
    )

    const planReview = broadcasts.find(
      (event) =>
        event.type === 'activity' &&
        (event.payload as { kind?: string }).kind === 'plan-review',
    )
    expect(planReview?.sessionId).toBe(sessionId)
    expect((planReview?.payload as { reviewId?: string }).reviewId).toBeTruthy()
  })

  it('dispatches the gated execution session only after the plan is approved', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })

    const planning = await manager.dispatch({
      projectId: project.id,
      prompt: 'add a settings page',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      planMode: true,
    })

    adapter.emit({
      type: 'session-complete',
      sessionId: planning.sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    await waitFor(() =>
      broadcasts.some(
        (event) =>
          event.type === 'activity' &&
          (event.payload as { kind?: string }).kind === 'plan-review',
      ),
    )

    // The gate: no execution session exists until the user approves.
    expect(adapter.dispatches).toHaveLength(1)

    const reviewEvent = broadcasts.find(
      (event) =>
        event.type === 'activity' &&
        (event.payload as { kind?: string }).kind === 'plan-review',
    )
    const reviewId = (reviewEvent?.payload as { reviewId: string }).reviewId

    const execution = await manager.resolvePlanReview({
      reviewId,
      sessionId: planning.sessionId,
      decision: 'approve',
    })

    expect(execution).not.toBeNull()
    expect(execution?.threadId).toBe(planning.threadId)
    expect(adapter.dispatches).toHaveLength(2)
    expect(adapter.dispatches[1]?.prompt).toBe(buildPlanExecutionPrompt())
  })

  it('does not dispatch an execution session when the plan is rejected', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })

    const planning = await manager.dispatch({
      projectId: project.id,
      prompt: 'add a settings page',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      planMode: true,
    })

    adapter.emit({
      type: 'session-complete',
      sessionId: planning.sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    await waitFor(() =>
      broadcasts.some(
        (event) =>
          event.type === 'activity' &&
          (event.payload as { kind?: string }).kind === 'plan-review',
      ),
    )

    const reviewEvent = broadcasts.find(
      (event) =>
        event.type === 'activity' &&
        (event.payload as { kind?: string }).kind === 'plan-review',
    )
    const reviewId = (reviewEvent?.payload as { reviewId: string }).reviewId

    const rejected = await manager.resolvePlanReview({
      reviewId,
      sessionId: planning.sessionId,
      decision: 'reject',
    })
    expect(rejected).toBeNull()
    expect(adapter.dispatches).toHaveLength(1)

    // The review is consumed — a second decision on the same id is a no-op.
    const replay = await manager.resolvePlanReview({
      reviewId,
      sessionId: planning.sessionId,
      decision: 'approve',
    })
    expect(replay).toBeNull()
    expect(adapter.dispatches).toHaveLength(1)
  })

  it('returns null when resolving an unknown plan review', async () => {
    const adapter = new FakeAdapter()
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: () => undefined,
      worktreeIsolation: false,
    })

    await expect(
      manager.resolvePlanReview({
        reviewId: 'missing-review',
        sessionId: 'missing-session',
        decision: 'approve',
      }),
    ).resolves.toBeNull()
  })

  it('never auto-applies diffs or runs the quality gate for a plan-mode session', async () => {
    const repoPath = await createGitRepo(tempDirs)
    const project = createProject(repoPath)
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const qualityGateRunner = vi.fn(async () => undefined)
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      qualityGateRunner,
      worktreeIsolation: true,
    })

    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'add a settings page',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      planMode: true,
    })

    // The planning agent ignores the no-changes instruction and edits its
    // isolated worktree anyway — plan mode must still leave the repo untouched.
    const worktreePath = adapter.dispatchedParams?.repoPath
    expect(worktreePath).toBeTruthy()
    await fs.writeFile(path.join(worktreePath ?? '', 'existing.ts'), 'planning edit\n', 'utf-8')

    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    await waitFor(() =>
      broadcasts.some(
        (event) =>
          event.type === 'activity' &&
          (event.payload as { kind?: string }).kind === 'plan-review',
      ),
    )

    // The repo is untouched: no diff applied, no diff event, no quality gate.
    await expect(fs.readFile(path.join(repoPath, 'existing.ts'), 'utf-8')).resolves.toBe(
      'original\n',
    )
    expect(broadcasts.map((event) => event.type)).not.toContain('diff')
    expect(qualityGateRunner).not.toHaveBeenCalled()
  })

  it('dispatches queued follow-ups when a plan is rejected', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })

    const planning = await manager.dispatch({
      projectId: project.id,
      prompt: 'add a settings page',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      planMode: true,
    })

    // A follow-up is queued while the plan is pending review.
    manager.enqueueMessage(
      {
        prompt: 'then add tests',
        agentId: 'claude-code',
        model: 'claude-sonnet-4-6',
        approvalMode: 'manual',
        runtimeSettings: {
          enabled: true,
          command: '',
          permissionMode: 'ask-for-approval',
          extraArgs: [],
        },
      },
      planning.threadId,
    )
    expect(manager.getQueue(planning.threadId)[0]).toMatchObject({
      prompt: 'then add tests',
      approvalMode: 'manual',
    })
    expect(manager.getQueue(planning.threadId)[0]).not.toHaveProperty('runtimeSettings')

    adapter.emit({
      type: 'session-complete',
      sessionId: planning.sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    const reviewId = await waitForPlanReviewId(broadcasts)

    await manager.resolvePlanReview({
      reviewId,
      sessionId: planning.sessionId,
      decision: 'reject',
    })

    // The queued follow-up runs instead of being stranded on an idle thread.
    await waitFor(() => adapter.dispatches.length === 2)
    expect(adapter.dispatches[1]?.prompt).toBe('then add tests')
    expect(adapter.dispatches[1]?.runtimeSettings?.permissionMode).toBe('ask-for-approval')
    expect(manager.getQueue(planning.threadId)).toHaveLength(0)
  })

  it('retrieves execution-session context with the original task, not the approval prompt', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const contextQueries: string[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
      resolveContext: async ({ prompt, baseContext }) => {
        contextQueries.push(prompt)
        return baseContext ?? null
      },
    })

    const planning = await manager.dispatch({
      projectId: project.id,
      prompt: 'add a settings page',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      planMode: true,
    })

    adapter.emit({
      type: 'session-complete',
      sessionId: planning.sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    const reviewId = await waitForPlanReviewId(broadcasts)

    await manager.resolvePlanReview({
      reviewId,
      sessionId: planning.sessionId,
      decision: 'approve',
    })

    // Both phases query repo context with the raw task — the execution phase
    // must NOT search with the generic "plan approved" prompt.
    expect(contextQueries).toEqual(['add a settings page', 'add a settings page'])
    expect(contextQueries[1]).not.toMatch(/approved/i)
  })

  it('leaves the queue intact when a plan is rejected while the thread is still busy', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })

    const planning = await manager.dispatch({
      projectId: project.id,
      prompt: 'add a settings page',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      planMode: true,
    })

    adapter.emit({
      type: 'session-complete',
      sessionId: planning.sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    const reviewId = await waitForPlanReviewId(broadcasts)

    // Newer work is dispatched on the same thread and is still running when
    // the older plan is rejected.
    const running = await manager.dispatch({
      projectId: project.id,
      threadId: planning.threadId,
      prompt: 'unrelated follow-up work',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })
    manager.enqueueMessage(
      { prompt: 'then add tests', agentId: 'claude-code', model: 'claude-sonnet-4-6' },
      planning.threadId,
    )

    await manager.resolvePlanReview({
      reviewId,
      sessionId: planning.sessionId,
      decision: 'reject',
    })

    // The queued follow-up is NOT dispatched: the thread already has a running
    // session, so dispatching now would start a second concurrent session.
    expect(adapter.dispatches).toHaveLength(2)
    expect(manager.getQueue(planning.threadId)).toHaveLength(1)

    // Once the running session completes, its normal completion path drains
    // the queue in order.
    adapter.emit({
      type: 'session-complete',
      sessionId: running.sessionId,
      payload: { exitCode: 0 },
      timestamp: 20,
    })

    await waitFor(() => adapter.dispatches.length === 3)
    expect(adapter.dispatches[2]?.prompt).toBe('then add tests')
    expect(manager.getQueue(planning.threadId)).toHaveLength(0)
  })

  it('ignores a plan-review decision whose sessionId does not match the planning session', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })

    const planning = await manager.dispatch({
      projectId: project.id,
      prompt: 'add a settings page',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      planMode: true,
    })

    adapter.emit({
      type: 'session-complete',
      sessionId: planning.sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    const reviewId = await waitForPlanReviewId(broadcasts)

    // A decision carrying the wrong planning sessionId — a stale or misrouted
    // UI event — must not dispatch and must not consume the review.
    const mismatched = await manager.resolvePlanReview({
      reviewId,
      sessionId: 'some-other-session',
      decision: 'approve',
    })
    expect(mismatched).toBeNull()
    expect(adapter.dispatches).toHaveLength(1)

    // The review survives the mismatch — the correctly paired decision still
    // resolves it and dispatches the execution session.
    const execution = await manager.resolvePlanReview({
      reviewId,
      sessionId: planning.sessionId,
      decision: 'approve',
    })
    expect(execution).not.toBeNull()
    expect(adapter.dispatches).toHaveLength(2)
  })
})

class FakeAdapter implements AgentAdapter {
  id = 'claude-code' as const
  events = new EventEmitter()
  approve = vi.fn()
  reject = vi.fn()
  cancel = vi.fn()
  dispatchedParams: Parameters<AgentAdapter['dispatch']>[0] | null = null
  dispatches: Array<Parameters<AgentAdapter['dispatch']>[0]> = []

  async dispatch(params: Parameters<AgentAdapter['dispatch']>[0]): Promise<AgentSession> {
    this.dispatchedParams = params
    this.dispatches.push(params)

    return {
      sessionId: params.sessionId,
      events: this.events,
      approve: this.approve,
      reject: this.reject,
      cancel: this.cancel,
    }
  }

  emit(event: AgentEvent): void {
    this.events.emit('event', event)
  }
}

function createProject(repoPath = '/repo/session') {
  return projectsStore.create({
    name: 'Session project',
    repoPath,
    agentId: 'claude-code',
    modelTier: 'balanced',
  })
}

async function createGitRepo(tempDirs: string[]): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobrecs-agent-session-'))
  tempDirs.push(repoPath)

  await git(repoPath, ['init'])
  await git(repoPath, ['config', 'user.email', 'agent@example.test'])
  await git(repoPath, ['config', 'user.name', 'Agent Test'])
  await fs.writeFile(path.join(repoPath, 'existing.ts'), 'original\n', 'utf-8')
  await git(repoPath, ['add', '.'])
  await git(repoPath, ['commit', '-m', 'initial commit'])

  return repoPath
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, encoding: 'utf-8' })
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  throw new Error('Timed out waiting for condition')
}

/** Waits for a `plan-review` activity broadcast and returns its `reviewId`. */
async function waitForPlanReviewId(broadcasts: AgentEvent[]): Promise<string> {
  const isPlanReview = (event: AgentEvent): boolean =>
    event.type === 'activity' &&
    (event.payload as { kind?: string }).kind === 'plan-review'

  await waitFor(() => broadcasts.some(isPlanReview))
  return (broadcasts.find(isPlanReview)?.payload as { reviewId: string }).reviewId
}
