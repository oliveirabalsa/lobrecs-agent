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
