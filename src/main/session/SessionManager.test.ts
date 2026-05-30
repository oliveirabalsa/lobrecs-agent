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
import {
  closeDb,
  projectsStore,
  promptEvidenceStore,
  sessionsStore,
  setDbForTests,
  threadsStore,
} from '../store'
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

    expect(eventTypesExcludingStartup(broadcasts)).toEqual([
      'stdout',
      'activity',
      'session-complete',
    ])
    expect(eventTypesExcludingStartup(sessionsStore.listEvents(sessionId))).toEqual([
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

  it('emits an idle heartbeat while an agent process is still running silently', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      idleHeartbeatMs: 10,
    })

    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'think for a while',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    await waitFor(() =>
      broadcasts.some(
        (event) =>
          event.type === 'activity' &&
          typeof event.payload === 'object' &&
          event.payload !== null &&
          (event.payload as { title?: string }).title === 'Waiting for agent output',
      ),
    )

    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 0 },
      timestamp: 20,
    })
    await waitFor(() => sessionsStore.get(sessionId)?.status === 'done')
    expect(manager.isActive(sessionId)).toBe(false)
  })

  it('records startup phase diagnostics before agent output', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
      resolveContext: async ({ baseContext }) => `${baseContext}\nAPI_KEY=secret-value-12345`,
    })

    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'diagnose startup',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      context: 'AGENTS.md',
    })
    adapter.emit({ type: 'stdout', sessionId, payload: { text: 'first output' }, timestamp: 10 })

    const startupTitles = broadcasts
      .filter(isStartupDiagnostic)
      .map((event) => (event.payload as { title: string }).title)

    expect(startupTitles).toEqual([
      'Preparing context',
      'Context ready',
      'Starting agent process',
      'Agent process started',
    ])
    expect(adapter.dispatchedParams?.context).not.toContain('secret-value-12345')
    expect(adapter.dispatchedParams?.context).toContain('[REDACTED_SECRET]')
  })

  it('can return a durable session before slow context resolution finishes', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    let resolveContext!: (context: string) => void
    const contextGate = new Promise<string>((resolve) => {
      resolveContext = resolve
    })
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
      resolveContext: async () => contextGate,
    })

    const { sessionId, threadId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'send immediately',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      returnAfterSessionCreated: true,
    })

    expect(typeof threadId).toBe('string')
    expect(sessionsStore.get(sessionId)).toMatchObject({
      prompt: 'send immediately',
      status: 'running',
      threadId,
    })
    expect(manager.isActive(sessionId)).toBe(true)
    expect(adapter.dispatchedParams).toBeNull()
    expect(
      broadcasts.some(
        (event) =>
          event.sessionId === sessionId &&
          event.type === 'activity' &&
          (event.payload as { title?: string }).title === 'Preparing context',
      ),
    ).toBe(true)

    resolveContext('resolved context')
    await waitFor(() => adapter.dispatchedParams !== null)
    expect(adapter.dispatchedParams).toMatchObject({
      sessionId,
      context: 'resolved context',
    })
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
    expect(eventTypesExcludingStartup(sessionsStore.listEvents(sessionId))).toEqual([
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
    expect(eventTypesExcludingStartup(broadcasts)).toEqual(['stdout', 'activity'])
  })

  it('pauses when an adapter emits a normalized user-question activity directly', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const manager = new SessionManager({
      adapters: [adapter],
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
      type: 'activity',
      sessionId,
      payload: {
        kind: 'user-question',
        promptId: 'user-question:claude-toolu-1',
        title: 'Agent question',
        questions: [
          {
            id: 'question-1',
            question: 'Which files should I focus?',
            multiSelect: false,
            options: [{ id: 'option-1', label: 'Renderer only' }],
          },
        ],
      },
      timestamp: 10,
    })

    expect(sessionsStore.get(sessionId)?.status).toBe('awaiting-input')
    expect(manager.isActive(sessionId)).toBe(false)
    expect(adapter.cancel).toHaveBeenCalledTimes(1)
  })

  it('clears awaiting-input recovery state when a paused session is cancelled', async () => {
    const project = createProject()
    const claudeAdapter = new FakeAdapter('claude-code')
    const codexAdapter = new FakeAdapter('codex')
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [claudeAdapter, codexAdapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'finish the refactor',
      agentId: 'claude-code',
      model: 'claude-opus-4-7',
      repoPath: project.repoPath,
    })

    claudeAdapter.emit({
      type: 'error',
      sessionId,
      payload: { message: 'Claude usage limit reached. Please try again later.' },
      timestamp: 10,
    })

    await waitFor(() => sessionsStore.get(sessionId)?.status === 'awaiting-input')
    const recoveryEvent = broadcasts.find(
      (event) =>
        event.type === 'activity' &&
        typeof event.payload === 'object' &&
        event.payload !== null &&
        (event.payload as { kind?: string }).kind === 'model-recovery',
    )
    const recoveryId = (recoveryEvent?.payload as { recoveryId?: string } | undefined)
      ?.recoveryId

    expect(recoveryId).toBeTruthy()

    manager.cancel(sessionId)

    expect(sessionsStore.get(sessionId)?.status).toBe('cancelled')
    expect(manager.isActive(sessionId)).toBe(false)
    await expect(
      manager.resolveModelRecovery({
        recoveryId: recoveryId!,
        sessionId,
        decision: 'continue',
        agentId: 'codex',
        modelOverride: 'gpt-5.4',
      }),
    ).resolves.toBeNull()
    expect(codexAdapter.dispatches).toHaveLength(0)
  })

  it('clears awaiting-approval state when a session fails', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const manager = new SessionManager({
      adapters: [adapter],
      worktreeIsolation: false,
    })
    const { sessionId, threadId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'needs approval',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    adapter.emit({
      type: 'approval-request',
      sessionId,
      payload: { command: 'npm test' },
      timestamp: 10,
    })
    expect(sessionsStore.get(sessionId)?.status).toBe('awaiting-approval')

    adapter.emit({
      type: 'error',
      sessionId,
      payload: { message: 'agent process failed' },
      timestamp: 11,
    })

    expect(sessionsStore.get(sessionId)?.status).toBe('error')
    expect(manager.isActive(sessionId)).toBe(false)

    await manager.dispatch({
      projectId: project.id,
      threadId,
      prompt: 'next attempt',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    expect(adapter.dispatches.at(-1)?.prompt).toBe('next attempt')
  })

  it('pauses on provider limits and continues with a user-selected model', async () => {
    const project = createProject()
    const claudeAdapter = new FakeAdapter('claude-code')
    const codexAdapter = new FakeAdapter('codex')
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [claudeAdapter, codexAdapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })
    const { sessionId, threadId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'finish the refactor',
      agentId: 'claude-code',
      model: 'claude-opus-4-7',
      repoPath: project.repoPath,
    })

    claudeAdapter.emit({
      type: 'error',
      sessionId,
      payload: { message: 'Claude usage limit reached. Please try again later.' },
      timestamp: 10,
    })

    await waitFor(() => sessionsStore.get(sessionId)?.status === 'awaiting-input')
    const recoveryEvent = broadcasts.find(
      (event) =>
        event.type === 'activity' &&
        typeof event.payload === 'object' &&
        event.payload !== null &&
        (event.payload as { kind?: string }).kind === 'model-recovery',
    )
    const recoveryId = (recoveryEvent?.payload as { recoveryId?: string } | undefined)
      ?.recoveryId

    expect(recoveryId).toBeTruthy()
    expect(sessionsStore.listEvents(sessionId).some((event) => event.type === 'error')).toBe(false)
    expect(manager.isActive(sessionId)).toBe(false)

    const continued = await manager.resolveModelRecovery({
      recoveryId: recoveryId!,
      sessionId,
      decision: 'continue',
      agentId: 'codex',
      modelOverride: 'gpt-5.4',
    })

    expect(continued?.threadId).toBe(threadId)
    expect(codexAdapter.dispatchedParams).toMatchObject({
      prompt: 'finish the refactor',
      repoPath: project.repoPath,
      model: 'gpt-5.4',
    })
  })

  it('auto retries managed swarm sessions with related fallback models', async () => {
    const project = createProject()
    const adapter = new FakeAdapter('claude-code')
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'finish the managed swarm task',
      agentId: 'claude-code',
      model: 'claude-opus-4-7',
      modelFallbacks: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      modelRecoveryMode: 'auto',
      repoPath: project.repoPath,
      spawnedAgent: { kind: 'swarm', role: 'manager' },
    })

    adapter.emit({
      type: 'error',
      sessionId,
      payload: { message: 'Claude usage limit reached. Please try again later.' },
      timestamp: 10,
    })

    await waitFor(() => adapter.dispatches.length === 2)

    expect(sessionsStore.get(sessionId)).toMatchObject({
      status: 'running',
      model: 'claude-sonnet-4-6',
    })
    expect(adapter.dispatches[1]).toMatchObject({
      sessionId,
      model: 'claude-sonnet-4-6',
      modelFallbacks: ['claude-haiku-4-5-20251001'],
    })
    expect(
      broadcasts.some(
        (event) =>
          event.type === 'activity' &&
          typeof event.payload === 'object' &&
          event.payload !== null &&
          (event.payload as { kind?: string }).kind === 'model-recovery',
      ),
    ).toBe(false)

    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 0 },
      timestamp: 20,
    })

    await waitFor(() => sessionsStore.get(sessionId)?.status === 'done')
  })

  it('auto retries managed swarm sessions when a selected model is unsupported', async () => {
    const project = createProject()
    const adapter = new FakeAdapter('codex')
    const manager = new SessionManager({
      adapters: [adapter],
      worktreeIsolation: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'finish the managed swarm task',
      agentId: 'codex',
      model: 'gpt-5.5-codex',
      modelFallbacks: ['gpt-5.3-codex', 'gpt-5.3-codex-spark'],
      modelRecoveryMode: 'auto',
      repoPath: project.repoPath,
      spawnedAgent: { kind: 'swarm', role: 'implementer' },
    })

    adapter.emit({
      type: 'error',
      sessionId,
      payload: {
        message:
          "The 'gpt-5.5-codex' model is not supported when using Codex with a ChatGPT account.",
      },
      timestamp: 10,
    })

    await waitFor(() => adapter.dispatches.length === 2)

    expect(sessionsStore.get(sessionId)).toMatchObject({
      status: 'running',
      model: 'gpt-5.3-codex',
    })
    expect(adapter.dispatches[1]).toMatchObject({
      sessionId,
      model: 'gpt-5.3-codex',
      modelFallbacks: ['gpt-5.3-codex-spark'],
    })
  })

  it('auto retries managed swarm sessions when a provider API reports model not found', async () => {
    const project = createProject()
    const adapter = new FakeAdapter('opencode')
    const manager = new SessionManager({
      adapters: [adapter],
      worktreeIsolation: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'finish the managed swarm task',
      agentId: 'opencode',
      model: 'minimax/broken-model',
      modelFallbacks: ['qwen/qwen3-coder', 'anthropic/claude-sonnet-4.5'],
      modelRecoveryMode: 'auto',
      repoPath: project.repoPath,
      spawnedAgent: { kind: 'swarm', role: 'implementer' },
    })

    adapter.emit({
      type: 'error',
      sessionId,
      payload: {
        name: 'APIError',
        data: {
          message: '404 Page not found',
          statusCode: 404,
          metadata: { url: 'https://api.minimaxi.chat/v1/messages' },
        },
        responseBody: '404 page not found',
      },
      timestamp: 10,
    })

    await waitFor(() => adapter.dispatches.length === 2)

    expect(sessionsStore.get(sessionId)).toMatchObject({
      status: 'running',
      model: 'qwen/qwen3-coder',
    })
    expect(adapter.dispatches[1]).toMatchObject({
      sessionId,
      model: 'qwen/qwen3-coder',
      modelFallbacks: ['anthropic/claude-sonnet-4.5'],
    })
  })

  it('pauses for model recovery when a process warning reports a session limit', async () => {
    const project = createProject()
    const adapter = new FakeAdapter('claude-code')
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'continue this task',
      agentId: 'claude-code',
      model: 'claude-haiku-4-5-20251001',
      repoPath: project.repoPath,
    })
    const reason = "You've hit your session limit · resets 3:40am (America/Sao_Paulo)"

    adapter.emit({
      type: 'stderr',
      sessionId,
      payload: { text: reason },
      timestamp: 10,
    })
    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 1 },
      timestamp: 11,
    })

    await waitFor(() => sessionsStore.get(sessionId)?.status === 'awaiting-input')
    expect(manager.isActive(sessionId)).toBe(false)
    expect(
      broadcasts.some(
        (event) =>
          event.type === 'activity' &&
          typeof event.payload === 'object' &&
          event.payload !== null &&
          (event.payload as { kind?: string }).kind === 'model-recovery' &&
          (event.payload as { reason?: string }).reason === reason,
      ),
    ).toBe(true)
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

    expect(promptEvidenceStore.getForSession(adapter.dispatches[1]?.sessionId ?? '')).toMatchObject({
      prompt: 'add tests',
      resolvedContext: expect.stringContaining('Project knowledge base'),
      adapterContext: expect.stringContaining('Conversation history'),
    })
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
    const nonStartupBroadcasts = broadcasts.filter((event) => !isStartupDiagnostic(event))
    expect(nonStartupBroadcasts).toHaveLength(1)
    expect(nonStartupBroadcasts[0]).toMatchObject({
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
    const recorded = sessionsStore.listEvents(sessionId).filter((event) => !isStartupDiagnostic(event))
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      type: 'session-complete',
      payload: { status: 'cancelled' },
    })
    const nonStartupBroadcasts = broadcasts.filter((event) => !isStartupDiagnostic(event))
    expect(nonStartupBroadcasts).toHaveLength(1)
    expect(nonStartupBroadcasts[0]).toMatchObject({
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
    expect(broadcasts.find((event) => event.type === 'error')).toMatchObject({
      type: 'error',
      sessionId: session.id,
    })
  })

  it('notifies spawned automation failures that happen before the session becomes active', async () => {
    const project = createProject()
    const notifier = vi.fn()
    const manager = new SessionManager({
      broadcast: () => undefined,
      notifier,
      worktreeIsolation: false,
    })

    await expect(
      manager.dispatch({
        projectId: project.id,
        prompt: 'missing automation adapter',
        agentId: 'claude-code',
        model: 'claude-sonnet-4-6',
        repoPath: project.repoPath,
        spawnedAgent: { kind: 'automation', role: 'Nightly QA' },
      }),
    ).rejects.toThrow('Adapter not found')

    const [session] = sessionsStore.list(project.id)
    expect(notifier).toHaveBeenCalledWith({
      type: 'session.error',
      sessionId: session.id,
      projectId: project.id,
      threadId: session.threadId,
      message: 'Adapter not found: claude-code',
      spawnedAgent: { kind: 'automation', role: 'Nightly QA' },
    })
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

  it('notifies spawned automation completion when a non-git repo has no diff baseline', async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobrecs-agent-nongit-'))
    tempDirs.push(repoPath)
    const project = createProject(repoPath)
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const notifier = vi.fn()
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      notifier,
      worktreeIsolation: false,
    })
    const { sessionId, threadId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'run automation',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      spawnedAgent: { kind: 'automation', role: 'Nightly QA' },
    })

    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    await waitFor(() => broadcasts.some((event) => event.type === 'session-complete'))

    expect(notifier).toHaveBeenCalledWith({
      type: 'session.done',
      sessionId,
      projectId: project.id,
      threadId,
      spawnedAgent: { kind: 'automation', role: 'Nightly QA' },
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

  it('does not attribute another active thread local edits to a session that did not edit files', async () => {
    const repoPath = await createGitRepo(tempDirs)
    const project = createProject(repoPath)
    const adapter = new ScopedFakeAdapter()
    const manager = new SessionManager({
      adapters: [adapter],
      worktreeIsolation: false,
      idleHeartbeatMs: false,
    })

    const first = await manager.dispatch({
      projectId: project.id,
      prompt: 'edit locally',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })
    const second = await manager.dispatch({
      projectId: project.id,
      prompt: 'answer without edits',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    await fs.writeFile(path.join(repoPath, 'existing.ts'), 'updated by first\n', 'utf-8')
    adapter.emit({
      type: 'activity',
      sessionId: first.sessionId,
      payload: {
        kind: 'tool-call',
        name: 'Edit',
        input: { file_path: 'existing.ts' },
        status: 'done',
      },
      timestamp: 10,
    })
    adapter.emit({
      type: 'session-complete',
      sessionId: first.sessionId,
      payload: { exitCode: 0 },
      timestamp: 20,
    })
    await waitFor(() =>
      sessionsStore.listEvents(first.sessionId).some((event) => event.type === 'diff'),
    )

    adapter.emit({
      type: 'session-complete',
      sessionId: second.sessionId,
      payload: { exitCode: 0 },
      timestamp: 30,
    })

    await waitFor(() =>
      sessionsStore
        .listEvents(second.sessionId)
        .some((event) => event.type === 'session-complete'),
    )

    expect(
      sessionsStore
        .listEvents(first.sessionId)
        .some((event) => event.type === 'diff'),
    ).toBe(true)
    expect(
      sessionsStore
        .listEvents(second.sessionId)
        .some((event) => event.type === 'diff'),
    ).toBe(false)
    expect(
      sessionsStore.listEvents(second.sessionId).some(
        (event) =>
          event.type === 'activity' &&
          typeof event.payload === 'object' &&
          event.payload !== null &&
          (event.payload as { kind?: string }).kind === 'file-change',
      ),
    ).toBe(false)
  })

  it('emits live local diff snapshots after file-edit activity', async () => {
    const repoPath = await createGitRepo(tempDirs)
    const project = createProject(repoPath)
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
      idleHeartbeatMs: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'edit locally',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    await fs.writeFile(path.join(repoPath, 'existing.ts'), 'updated locally\n', 'utf-8')
    adapter.emit({
      type: 'activity',
      sessionId,
      payload: {
        kind: 'tool-call',
        name: 'Edit',
        input: { file_path: 'existing.ts' },
        status: 'done',
      },
      timestamp: 10,
    })

    await waitFor(() =>
      broadcasts.some((event) => event.type === 'diff' && isLiveDiffPayload(event.payload)),
    )

    const liveDiff = broadcasts.find(
      (event) => event.type === 'diff' && isLiveDiffPayload(event.payload),
    )
    const proposals = proposalsFromLiveDiffPayload(liveDiff?.payload)

    expect(proposals).toEqual([
      expect.objectContaining({
        filePath: path.join(repoPath, 'existing.ts'),
        originalContent: 'original\n',
        proposedContent: 'updated locally\n',
        additions: 1,
        deletions: 1,
        status: 'applied',
      }),
    ])
    expect(
      sessionsStore.listEvents(sessionId).some(
        (event) =>
          event.type === 'activity' &&
          typeof event.payload === 'object' &&
          event.payload !== null &&
          (event.payload as { kind?: string }).kind === 'diff-summary',
      ),
    ).toBe(false)
    expect(
      sessionsStore
        .listEvents(sessionId)
        .some((event) => event.type === 'diff' && isLiveDiffPayload(event.payload)),
    ).toBe(false)
  })

  it('emits live local diffs only for the editing session when local repo sessions overlap', async () => {
    const repoPath = await createGitRepo(tempDirs)
    const project = createProject(repoPath)
    const adapter = new ScopedFakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
      idleHeartbeatMs: false,
    })
    const first = await manager.dispatch({
      projectId: project.id,
      prompt: 'edit locally',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })
    const second = await manager.dispatch({
      projectId: project.id,
      prompt: 'answer without edits',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    await fs.writeFile(path.join(repoPath, 'existing.ts'), 'updated by first\n', 'utf-8')
    adapter.emit({
      type: 'activity',
      sessionId: first.sessionId,
      payload: {
        kind: 'tool-call',
        name: 'functions.apply_patch',
        input: JSON.stringify({
          patch: [
            '*** Begin Patch',
            '*** Update File: existing.ts',
            '@@',
            '-original',
            '+updated by first',
            '*** End Patch',
          ].join('\n'),
        }),
        status: 'done',
      },
      timestamp: 10,
    })

    await waitFor(() =>
      broadcasts.some((event) => event.type === 'diff' && isLiveDiffPayload(event.payload)),
    )

    const liveDiffs = broadcasts.filter(
      (event) => event.type === 'diff' && isLiveDiffPayload(event.payload),
    )

    expect(liveDiffs).toHaveLength(1)
    expect(liveDiffs[0].sessionId).toBe(first.sessionId)
    expect(liveDiffs[0].sessionId).not.toBe(second.sessionId)
    expect(proposalsFromLiveDiffPayload(liveDiffs[0].payload)).toEqual([
      expect.objectContaining({
        filePath: path.join(repoPath, 'existing.ts'),
        proposedContent: 'updated by first\n',
      }),
    ])
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

  it('keeps a thread-level worktree across sessions until it is brought back', async () => {
    const repoPath = await createGitRepo(tempDirs)
    const project = createProject(repoPath)
    const thread = threadsStore.create({ projectId: project.id, title: 'Handoff thread' })
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
    })

    const moved = await manager.moveThreadToWorktree(
      { projectId: project.id, threadId: thread.id, cleanupPolicy: 'manual' },
      repoPath,
    )

    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      threadId: thread.id,
      prompt: 'edit in the handoff worktree',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath,
    })

    expect(adapter.dispatchedParams?.repoPath).toBe(moved.worktreePath)
    await fs.writeFile(
      path.join(adapter.dispatchedParams?.repoPath ?? '', 'existing.ts'),
      'handoff edit\n',
      'utf-8',
    )

    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 0 },
      timestamp: 20,
    })

    await waitFor(() => broadcasts.some((event) => event.type === 'diff'))
    expect(worktreeManager.getThreadWorktree(thread.id)?.worktreePath).toBe(moved.worktreePath)
    await expect(fs.readFile(path.join(repoPath, 'existing.ts'), 'utf-8')).resolves.toBe(
      'original\n',
    )

    const diffEvent = broadcasts.find((event) => event.type === 'diff')
    expect(diffEvent?.payload).toEqual([
      expect.objectContaining({
        changeType: 'modified',
        status: 'pending',
      }),
    ])

    const broughtBack = await manager.bringThreadToLocal(
      { projectId: project.id, threadId: thread.id },
      repoPath,
    )
    await expect(fs.readFile(path.join(repoPath, 'existing.ts'), 'utf-8')).resolves.toBe(
      'handoff edit\n',
    )
    expect(broughtBack.location).toBe('worktree')
    expect(broughtBack.hasLocalChanges).toBe(true)
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

  it.each([
    { kind: 'swarm' as const, role: 'implementer' },
    { kind: 'delegation' as const, role: 'multitask-decomposer' },
  ])('skips the quality gate for $kind sessions after applied diffs', async (spawnedAgent) => {
    const repoPath = await createGitRepo(tempDirs)
    const project = createProject(repoPath)
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const qualityGateRunner = vi.fn(async () => undefined)
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
      spawnedAgent,
    })

    await fs.writeFile(path.join(repoPath, 'existing.ts'), 'updated by spawned agent\n', 'utf-8')

    adapter.emit({
      type: 'session-complete',
      sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    await waitFor(() => broadcasts.some((event) => event.type === 'session-complete'))

    expect(qualityGateRunner).not.toHaveBeenCalled()
  })

  it('keeps the quality gate enabled for QA repair sessions', async () => {
    const repoPath = await createGitRepo(tempDirs)
    const project = createProject(repoPath)
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const qualityGateRunner = vi.fn(async () => undefined)
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      qualityGateRunner,
      worktreeIsolation: false,
    })
    const { sessionId } = await manager.dispatch({
      projectId: project.id,
      prompt: 'repair locally',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      qualityAttempt: 1,
      spawnedAgent: { kind: 'quality-repair', role: 'QA repair agent' },
    })

    await fs.writeFile(path.join(repoPath, 'existing.ts'), 'updated by repair\n', 'utf-8')

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
        attempt: 1,
      }),
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
    const project = createProject(await createGitRepo(tempDirs))
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

  it('forces plan mode into a disposable worktree even when worktree isolation is off', async () => {
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
      prompt: 'add a settings page',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
      planMode: true,
    })

    const worktreePath = adapter.dispatchedParams?.repoPath
    expect(worktreePath).toBeTruthy()
    expect(worktreePath).not.toBe(project.repoPath)

    // Even if the planning agent writes into its checkout, the repo the user
    // opened must stay untouched until approval.
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

    await expect(fs.readFile(path.join(project.repoPath, 'existing.ts'), 'utf-8')).resolves.toBe(
      'original\n',
    )
  })

  it('dispatches the gated execution session only after the plan is approved', async () => {
    const project = createProject(await createGitRepo(tempDirs))
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

  it('dispatches execution with edited plan instructions when approval includes edits', async () => {
    const project = createProject(await createGitRepo(tempDirs))
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
    await manager.resolvePlanReview({
      reviewId,
      sessionId: planning.sessionId,
      decision: 'approve',
      editedPlanText: '1. Add UI control\n2. Add tests',
      suggestionText: 'Keep execution on the same thread context.',
    })

    expect(adapter.dispatches).toHaveLength(2)
    expect(adapter.dispatches[1]?.prompt).toBe(
      buildPlanExecutionPrompt({
        editedPlanText: '1. Add UI control\n2. Add tests',
        suggestionText: 'Keep execution on the same thread context.',
      }),
    )
  })

  it('dispatches execution with the implementation agent and model selected at approval time', async () => {
    const project = createProject(await createGitRepo(tempDirs))
    const planningAdapter = new FakeAdapter('claude-code')
    const implementationAdapter = new FakeAdapter('codex')
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [planningAdapter, implementationAdapter],
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

    planningAdapter.emit({
      type: 'session-complete',
      sessionId: planning.sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    const reviewId = await waitForPlanReviewId(broadcasts)
    const execution = await manager.resolvePlanReview({
      reviewId,
      sessionId: planning.sessionId,
      decision: 'approve',
      agentId: 'codex',
      modelOverride: 'gpt-5.3-codex',
    })

    expect(execution).not.toBeNull()
    expect(execution?.threadId).toBe(planning.threadId)
    expect(planningAdapter.dispatches).toHaveLength(1)
    expect(implementationAdapter.dispatches).toHaveLength(1)
    expect(implementationAdapter.dispatches[0]).toMatchObject({
      prompt: buildPlanExecutionPrompt(),
      model: 'gpt-5.3-codex',
    })
  })

  it('applies execution overrides when approving a plan with a different implementation model', async () => {
    const project = createProject(await createGitRepo(tempDirs))
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
      runtimeSettings: {
        enabled: true,
        command: 'claude',
        permissionMode: 'ask-for-approval',
        extraArgs: [],
      },
    })

    adapter.emit({
      type: 'session-complete',
      sessionId: planning.sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })

    const reviewId = await waitForPlanReviewId(broadcasts)
    await manager.resolvePlanReview(
      {
        reviewId,
        sessionId: planning.sessionId,
        decision: 'approve',
        modelOverride: 'claude-opus-4-7',
      },
      {
        runtimeSettings: {
          enabled: true,
          command: 'claude',
          permissionMode: 'dangerous',
          extraArgs: ['--verbose'],
        },
        modelFallbacks: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      },
    )

    expect(adapter.dispatches[1]).toMatchObject({
      model: 'claude-opus-4-7',
      modelFallbacks: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      runtimeSettings: {
        command: 'claude',
        permissionMode: 'dangerous',
        extraArgs: ['--verbose'],
      },
    })
  })

  it('keeps a plan review pending when approval dispatch fails so the user can retry', async () => {
    const project = createProject(await createGitRepo(tempDirs))
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
    await expect(
      manager.resolvePlanReview({
        reviewId,
        sessionId: planning.sessionId,
        decision: 'approve',
        agentId: 'codex',
        modelOverride: 'gpt-5.3-codex',
      }),
    ).rejects.toThrow('Adapter not found: codex')

    expect(manager.getPendingPlanReview(reviewId)).toMatchObject({
      reviewId,
      planningSessionId: planning.sessionId,
    })

    const retry = await manager.resolvePlanReview({
      reviewId,
      sessionId: planning.sessionId,
      decision: 'approve',
    })

    expect(retry).not.toBeNull()
    expect(adapter.dispatches).toHaveLength(2)
    expect(manager.getPendingPlanReview(reviewId)).toBeNull()
  })

  it('does not dispatch an execution session when the plan is rejected', async () => {
    const project = createProject(await createGitRepo(tempDirs))
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
    const project = createProject(await createGitRepo(tempDirs))
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
    const project = createProject(await createGitRepo(tempDirs))
    const adapter = new FakeAdapter()
    const broadcasts: AgentEvent[] = []
    const contextRequests: Array<{ prompt: string; planMode?: boolean }> = []
    const manager = new SessionManager({
      adapters: [adapter],
      broadcast: (event) => broadcasts.push(event),
      worktreeIsolation: false,
      resolveContext: async ({ prompt, baseContext, planMode }) => {
        contextRequests.push({ prompt, planMode })
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
    expect(contextRequests).toEqual([
      { prompt: 'add a settings page', planMode: true },
      { prompt: 'add a settings page', planMode: false },
    ])
    expect(contextRequests[1]?.prompt).not.toMatch(/approved/i)
    const startupTitles = broadcasts
      .filter(isStartupDiagnostic)
      .map((event) => (event.payload as { title: string }).title)
    expect(startupTitles).toContain('Investigating repository for plan mode')
    expect(startupTitles).toContain('Plan-mode investigation ready')
  })

  it('leaves the queue intact when a plan is rejected while the thread is still busy', async () => {
    const project = createProject(await createGitRepo(tempDirs))
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
    const project = createProject(await createGitRepo(tempDirs))
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

  it('mirrors delegated child session progress into the parent stream', async () => {
    const project = createProject()
    const parentAdapter = new FakeAdapter('claude-code')
    const childAdapter = new FakeAdapter('codex')
    const broadcasts: AgentEvent[] = []
    const manager = new SessionManager({
      adapters: [parentAdapter, childAdapter],
      broadcast: (event) => broadcasts.push(event),
    })

    const parent = await manager.dispatch({
      projectId: project.id,
      prompt: 'Investigate the harness',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })
    const child = await manager.dispatch({
      projectId: project.id,
      prompt: '[Delegated task]\nResearch Hermes delegation',
      agentId: 'codex',
      model: 'gpt-5-codex',
      repoPath: project.repoPath,
      threadId: parent.threadId,
      spawnedAgent: { kind: 'delegation', role: 'Research Hermes delegation' },
      delegatedTask: {
        delegationId: 'delegate-1',
        parentSessionId: parent.sessionId,
        goal: 'Research Hermes delegation',
      },
    })

    expect(threadsStore.get(parent.threadId)?.lastSessionId).toBe(parent.sessionId)
    expect(sessionsStore.get(child.sessionId)?.spawnedAgent).toEqual({
      kind: 'delegation',
      role: 'Research Hermes delegation',
    })
    expect(latestDelegationActivity(broadcasts, parent.sessionId)).toMatchObject({
      delegationId: 'delegate-1',
      childSessionId: child.sessionId,
      status: 'running',
      agentId: 'codex',
      model: 'gpt-5-codex',
    })

    childAdapter.emit({
      type: 'stdout',
      sessionId: child.sessionId,
      payload: { text: 'Hermes child agents use isolated context.' },
      timestamp: 10,
    })

    expect(latestDelegationActivity(broadcasts, parent.sessionId)).toMatchObject({
      status: 'running',
      lastOutput: 'Hermes child agents use isolated context.',
    })

    childAdapter.emit({
      type: 'session-complete',
      sessionId: child.sessionId,
      payload: { exitCode: 0 },
      timestamp: 20,
    })

    expect(latestDelegationActivity(broadcasts, parent.sessionId)).toMatchObject({
      status: 'done',
      summary: 'Hermes child agents use isolated context.',
    })
  })

  it('does not make spawned background sessions the visible thread session', async () => {
    const project = createProject()
    const parentAdapter = new ScopedFakeAdapter('claude-code')
    const childAdapter = new ScopedFakeAdapter('codex')
    const manager = new SessionManager({
      adapters: [parentAdapter, childAdapter],
    })

    const parent = await manager.dispatch({
      projectId: project.id,
      prompt: 'Implement the workflow',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })
    const child = await manager.dispatch({
      projectId: project.id,
      prompt: '[Background task]\nInspect output handling',
      agentId: 'codex',
      model: 'gpt-5-codex',
      repoPath: project.repoPath,
      threadId: parent.threadId,
      spawnedAgent: { kind: 'swarm', role: 'Inspect output handling' },
    })

    expect(threadsStore.get(parent.threadId)?.lastSessionId).toBe(parent.sessionId)
    expect(sessionsStore.get(child.sessionId)?.spawnedAgent).toEqual({
      kind: 'swarm',
      role: 'Inspect output handling',
    })
  })

  it('queues one main-agent handoff after the parent and all delegated children finish', async () => {
    const project = createProject()
    const parentAdapter = new ScopedFakeAdapter('claude-code')
    const childAdapter = new ScopedFakeAdapter('codex')
    const manager = new SessionManager({
      adapters: [parentAdapter, childAdapter],
    })

    const parent = await manager.dispatch({
      projectId: project.id,
      prompt: 'Implement the delegated workflow',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })
    const childOne = await manager.dispatch({
      projectId: project.id,
      prompt: '[Delegated task]\nInspect output handling',
      agentId: 'codex',
      model: 'gpt-5-codex',
      repoPath: project.repoPath,
      threadId: parent.threadId,
      spawnedAgent: { kind: 'delegation', role: 'Inspect output handling' },
      delegatedTask: {
        delegationId: 'delegate-1',
        parentSessionId: parent.sessionId,
        goal: 'Inspect output handling',
      },
    })
    const childTwo = await manager.dispatch({
      projectId: project.id,
      prompt: '[Delegated task]\nInspect edited files',
      agentId: 'codex',
      model: 'gpt-5-codex',
      repoPath: project.repoPath,
      threadId: parent.threadId,
      spawnedAgent: { kind: 'delegation', role: 'Inspect edited files' },
      delegatedTask: {
        delegationId: 'delegate-2',
        parentSessionId: parent.sessionId,
        goal: 'Inspect edited files',
      },
    })

    parentAdapter.emit({
      type: 'session-complete',
      sessionId: parent.sessionId,
      payload: { exitCode: 0 },
      timestamp: 10,
    })
    await waitFor(() => sessionsStore.get(parent.sessionId)?.status === 'done')
    expect(parentAdapter.dispatches).toHaveLength(1)

    childAdapter.emit({
      type: 'stdout',
      sessionId: childOne.sessionId,
      payload: { text: 'Collected background output.' },
      timestamp: 20,
    })
    childAdapter.emit({
      type: 'diff',
      sessionId: childOne.sessionId,
      payload: [
        {
          filePath: `${project.repoPath}/src/background.ts`,
          changeType: 'modified',
          additions: 4,
          deletions: 1,
          status: 'applied',
        },
      ],
      timestamp: 21,
    })
    childAdapter.emit({
      type: 'session-complete',
      sessionId: childOne.sessionId,
      payload: { exitCode: 0 },
      timestamp: 22,
    })
    await waitFor(() => sessionsStore.get(childOne.sessionId)?.status === 'done')
    expect(parentAdapter.dispatches).toHaveLength(1)

    childAdapter.emit({
      type: 'stdout',
      sessionId: childTwo.sessionId,
      payload: { text: 'Edited file summary is ready.' },
      timestamp: 30,
    })
    childAdapter.emit({
      type: 'session-complete',
      sessionId: childTwo.sessionId,
      payload: { exitCode: 0 },
      timestamp: 31,
    })

    await waitFor(() => parentAdapter.dispatches.length === 2)
    expect(parentAdapter.dispatches[1]).toMatchObject({
      sessionId: expect.any(String),
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })
    expect(parentAdapter.dispatches[1]?.prompt).toContain('[Background agent handoff]')
    expect(parentAdapter.dispatches[1]?.prompt).toContain('Inspect output handling')
    expect(parentAdapter.dispatches[1]?.prompt).toContain('Collected background output.')
    expect(parentAdapter.dispatches[1]?.prompt).toContain('src/background.ts')
    expect(parentAdapter.dispatches[1]?.prompt).toContain('Inspect edited files')
    expect(parentAdapter.dispatches[1]?.prompt).toContain('Edited file summary is ready.')
  })

  it('runs delegate-task tool calls through the configured background runner', async () => {
    const project = createProject()
    const adapter = new FakeAdapter()
    const delegateTaskRunner = vi.fn().mockResolvedValue(undefined)
    const manager = new SessionManager({
      adapters: [adapter],
      delegateTaskRunner,
    })

    const parent = await manager.dispatch({
      projectId: project.id,
      prompt: 'Investigate the harness',
      agentId: 'claude-code',
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })

    adapter.emit({
      type: 'activity',
      sessionId: parent.sessionId,
      payload: {
        kind: 'tool-call',
        name: 'delegate_task',
        input: {
          goal: 'Research Hermes delegate_task behavior',
          context: 'Focus on isolated child context.',
        },
        status: 'running',
      },
      timestamp: 10,
    })

    await waitFor(() => delegateTaskRunner.mock.calls.length === 1)
    expect(delegateTaskRunner).toHaveBeenCalledWith({
      parentSessionId: parent.sessionId,
      projectId: project.id,
      threadId: parent.threadId,
      goal: 'Research Hermes delegate_task behavior',
      context: 'Focus on isolated child context.',
    })

    adapter.emit({
      type: 'activity',
      sessionId: parent.sessionId,
      payload: {
        kind: 'tool-call',
        name: 'delegate_task',
        input: {
          goal: 'Research Hermes delegate_task behavior',
          context: 'Focus on isolated child context.',
        },
        status: 'running',
      },
      timestamp: 11,
    })

    expect(delegateTaskRunner).toHaveBeenCalledTimes(1)
  })
})

class FakeAdapter implements AgentAdapter {
  id: AgentAdapter['id']
  events = new EventEmitter()
  approve = vi.fn()
  reject = vi.fn()
  cancel = vi.fn()
  dispatchedParams: Parameters<AgentAdapter['dispatch']>[0] | null = null
  dispatches: Array<Parameters<AgentAdapter['dispatch']>[0]> = []

  constructor(id: AgentAdapter['id'] = 'claude-code') {
    this.id = id
  }

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

class ScopedFakeAdapter extends FakeAdapter {
  private readonly eventsBySession = new Map<string, EventEmitter>()

  override async dispatch(
    params: Parameters<AgentAdapter['dispatch']>[0],
  ): Promise<AgentSession> {
    this.dispatchedParams = params
    this.dispatches.push(params)

    const events = new EventEmitter()
    this.eventsBySession.set(params.sessionId, events)

    return {
      sessionId: params.sessionId,
      events,
      approve: this.approve,
      reject: this.reject,
      cancel: this.cancel,
    }
  }

  override emit(event: AgentEvent): void {
    this.eventsBySession.get(event.sessionId)?.emit('event', event)
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

function eventTypesExcludingStartup(events: readonly AgentEvent[]): string[] {
  return events.filter((event) => !isStartupDiagnostic(event)).map((event) => event.type)
}

function isStartupDiagnostic(event: AgentEvent): boolean {
  if (event.type !== 'activity' || !event.payload || typeof event.payload !== 'object') {
    return false
  }

  const title = (event.payload as { title?: unknown }).title
  return (
    title === 'Preparing context' ||
    title === 'Investigating repository for plan mode' ||
    title === 'Context ready' ||
    title === 'Plan-mode investigation ready' ||
    title === 'Starting agent process' ||
    title === 'Agent process started'
  )
}

function isLiveDiffPayload(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { live?: unknown }).live === true
  )
}

function proposalsFromLiveDiffPayload(payload: unknown): unknown[] {
  if (!isLiveDiffPayload(payload)) return []

  const proposals = (payload as { proposals?: unknown }).proposals
  return Array.isArray(proposals) ? proposals : []
}

function latestDelegationActivity(
  events: readonly AgentEvent[],
  parentSessionId: string,
): unknown {
  return [...events]
    .reverse()
    .find(
      (event) =>
        event.sessionId === parentSessionId &&
        event.type === 'activity' &&
        typeof event.payload === 'object' &&
        event.payload !== null &&
        (event.payload as { kind?: unknown }).kind === 'delegation',
    )?.payload
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
  for (let attempt = 0; attempt < 300; attempt += 1) {
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
