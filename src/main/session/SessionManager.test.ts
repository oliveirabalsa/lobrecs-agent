import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../shared/types'
import { closeDb, projectsStore, sessionsStore, setDbForTests } from '../store'
import type { AgentAdapter, AgentSession } from './SessionManager'
import { SessionManager } from './SessionManager'

describe('SessionManager', () => {
  beforeEach(() => {
    setDbForTests(new Database(':memory:'))
  })

  afterEach(() => {
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
      worktreeIsolation: false,
    })

    const sessionId = await manager.dispatch({
      projectId: project.id,
      prompt: 'build store foundation',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      context: 'AGENTS.md',
    })

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
      'activity',
    ])
    expect(sessionsStore.listEvents(sessionId).map((event) => event.type)).toEqual([
      'stdout',
      'activity',
      'session-complete',
      'activity',
    ])
    expect(sessionsStore.get(sessionId)).toMatchObject({
      status: 'done',
      tokensIn: 1_000,
      tokensOut: 500,
      costUsd: 2,
    })
    expect(manager.isActive(sessionId)).toBe(false)
  })

  it('moves through approval state and delegates approval controls', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: () => undefined,
      worktreeIsolation: false,
    })
    const sessionId = await manager.dispatch({
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

    manager.approve(sessionId)

    expect(adapter.approve).toHaveBeenCalledTimes(1)
    expect(sessionsStore.get(sessionId)?.status).toBe('running')
  })

  it('cancels active sessions and marks them cancelled', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: () => undefined,
      worktreeIsolation: false,
    })
    const sessionId = await manager.dispatch({
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
    const sessionId = await manager.dispatch({
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
  })
})

class FakeAdapter implements AgentAdapter {
  id = 'claude-code' as const
  events = new EventEmitter()
  approve = vi.fn()
  reject = vi.fn()
  cancel = vi.fn()
  dispatchedParams: Parameters<AgentAdapter['dispatch']>[0] | null = null

  async dispatch(params: Parameters<AgentAdapter['dispatch']>[0]): Promise<AgentSession> {
    this.dispatchedParams = params

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

function createProject() {
  return projectsStore.create({
    name: 'Session project',
    repoPath: '/repo/session',
    agentId: 'claude-code',
    modelTier: 'balanced',
  })
}
