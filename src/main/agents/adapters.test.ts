import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaudeCodeAdapter } from './ClaudeCodeAdapter'
import { CodexAdapter } from './CodexAdapter'
import { OpenCodeAdapter } from './OpenCodeAdapter'
import { adapterRegistry } from './index'
import { processPool } from '../process/ProcessPool'
import type { AgentSession } from './AgentAdapter'
import type { AgentEvent } from '../../shared/types'

const claudeMock = fileURLToPath(new URL('./__mocks__/claude-mock.cjs', import.meta.url))
const codexMock = fileURLToPath(new URL('./__mocks__/codex-mock.cjs', import.meta.url))
const opencodeMock = fileURLToPath(new URL('./__mocks__/opencode-mock.cjs', import.meta.url))

describe('agent adapters', () => {
  afterEach(() => {
    delete process.env.CLAUDE_COMMAND
    delete process.env.CLAUDE_MOCK_RESULT_MODE
    delete process.env.CLAUDE_MOCK_SESSION_END_NOISE
    delete process.env.CLAUDE_MOCK_PLUGIN_WORKER_NOISE
    delete process.env.CODEX_COMMAND
    delete process.env.OPENCODE_COMMAND
    delete process.env.OPENCODE_MOCK_IMMEDIATE
    delete process.env.OPENCODE_MOCK_STEP_FINISH
    processPool.killAll()
  })

  it('registers all supported adapters', () => {
    expect(adapterRegistry.get('claude-code')).toBeInstanceOf(ClaudeCodeAdapter)
    expect(adapterRegistry.get('codex')).toBeInstanceOf(CodexAdapter)
    expect(adapterRegistry.get('opencode')).toBeInstanceOf(OpenCodeAdapter)
  })

  it('dispatches Claude Code with JSONL parsing and command override support', async () => {
    process.env.CLAUDE_COMMAND = claudeMock
    const adapter = new ClaudeCodeAdapter()

    expect(await adapter.isInstalled()).toBe(true)

    const session = await adapter.dispatch({
      sessionId: 'claude-session',
      prompt: 'Implement the task',
      repoPath: process.cwd(),
      model: 'opus',
      context: 'Always use rtk.',
    })
    const events = await collectEvents(session)
    const textDelta = events.find(
      (event) => payloadField(event, 'text') === 'Hello from Claude stream',
    )
    const assistantText = events.find(
      (event) => payloadField(event, 'text') === 'Hello from Claude mock\n',
    )
    const rawLine = events.find((event) => payloadField(event, 'text') === 'raw claude line\n')
    const toolCall = events.find(
      (event) => payloadField(event, 'kind') === 'tool-call' && payloadField(event, 'name') === 'Read',
    )
    const toolResult = events.find(
      (event) =>
        payloadField(event, 'kind') === 'tool-result' &&
        payloadField(event, 'output') === 'mock file output',
    )
    const stderrText = events
      .filter((event) => event.type === 'stderr')
      .map((event) => payloadField(event, 'text'))
      .join('\n')

    expect(textDelta?.type).toBe('stdout')
    expect(assistantText?.type).toBe('stdout')
    expect(events.some((event) => payloadField(event, 'output') === 'hook noise')).toBe(false)
    expect(events.some((event) => payloadField(event, 'thinking') === 'hidden thinking')).toBe(false)
    expect(stderrText).toContain('--output-format')
    expect(stderrText).toContain('stream-json')
    expect(stderrText).toContain('--input-format')
    expect(stderrText).toContain('--permission-mode')
    expect(stderrText).toContain('bypassPermissions')
    expect(stderrText).toContain('--verbose')
    expect(stderrText).toContain('--dangerously-skip-permissions')
    expect(stderrText).toContain('claude-opus-4-7')
    expect(stderrText).toContain('Repository instructions:')
    expect(toolCall).toMatchObject({ type: 'activity' })
    expect(toolResult).toMatchObject({ type: 'activity' })
    expect(rawLine?.type).toBe('stdout')
    expect(events.some((event) => event.type === 'stderr')).toBe(true)
    expect(events.some((event) => event.type === 'session-complete')).toBe(true)
  })

  it('surfaces Claude result errors as visible stderr and failed completion', async () => {
    process.env.CLAUDE_COMMAND = claudeMock
    process.env.CLAUDE_MOCK_RESULT_MODE = 'error'
    const adapter = new ClaudeCodeAdapter()

    const session = await adapter.dispatch({
      sessionId: 'claude-error-session',
      prompt: 'Trigger failure',
      repoPath: process.cwd(),
      model: 'claude-haiku-4-5-20251001',
    })
    const events = await collectEvents(session)
    const stderr = events.find((event) => event.type === 'stderr')
    const complete = events.find((event) => event.type === 'session-complete')

    expect(payloadField(stderr, 'text')).toBe('model failed\n')
    expect(payloadField(complete, 'exitCode')).toBe(1)
  })

  it('filters Claude SessionEnd cwd-deleted hook warnings from stderr', async () => {
    process.env.CLAUDE_COMMAND = claudeMock
    process.env.CLAUDE_MOCK_SESSION_END_NOISE = '1'
    const adapter = new ClaudeCodeAdapter()

    const session = await adapter.dispatch({
      sessionId: 'claude-hook-noise-session',
      prompt: 'Trigger hook noise',
      repoPath: process.cwd(),
      model: 'sonnet',
    })
    const events = await collectEvents(session)
    const stderrText = events
      .filter((event) => event.type === 'stderr')
      .map((event) => payloadField(event, 'text'))
      .join('\n')

    expect(stderrText).toContain('claude warning')
    expect(stderrText).not.toContain('SessionEnd hook')
    expect(stderrText).not.toContain('current working directory was deleted')
  })

  it('filters Claude plugin worker ENOENT noise from stderr', async () => {
    process.env.CLAUDE_COMMAND = claudeMock
    process.env.CLAUDE_MOCK_PLUGIN_WORKER_NOISE = '1'
    const adapter = new ClaudeCodeAdapter()

    const session = await adapter.dispatch({
      sessionId: 'claude-worker-noise-session',
      prompt: 'Trigger plugin worker noise',
      repoPath: process.cwd(),
      model: 'haiku',
    })
    const events = await collectEvents(session)
    const stderrText = events
      .filter((event) => event.type === 'stderr')
      .map((event) => payloadField(event, 'text'))
      .join('\n')

    expect(stderrText).toContain('claude warning')
    expect(stderrText).not.toContain('worker-service.cjs')
    expect(stderrText).not.toContain('agentforge-36c16d57')
    expect(stderrText).not.toContain('ENOENT')
  })

  it('dispatches Codex and maps approval requests', async () => {
    process.env.CODEX_COMMAND = codexMock
    const adapter = new CodexAdapter()

    expect(await adapter.isInstalled()).toBe(true)

    const session = await adapter.dispatch({
      sessionId: 'codex-session',
      prompt: 'Review the diff',
      repoPath: process.cwd(),
      model: 'gpt-5.3-codex',
      imageAttachments: [
        {
          filePath: '/tmp/mock-image.png',
          name: 'mock-image.png',
          mimeType: 'image/png',
          size: 1024,
        },
      ],
    })
    const events = await collectEvents(session)
    const approval = events.find((event) => event.type === 'approval-request')
    const stderrText = events
      .filter((event) => event.type === 'stderr')
      .map((event) => payloadField(event, 'text'))
      .join('\n')

    expect(approval).toBeDefined()
    expect(payloadField(approval, 'argv')).toEqual(
      expect.arrayContaining([
        'exec',
        '--model',
        'gpt-5.3-codex',
        '--image',
        '/tmp/mock-image.png',
        '--dangerously-bypass-approvals-and-sandbox',
      ]),
    )
    expect(events.some((event) => payloadField(event, 'text') === 'plain codex output')).toBe(true)
    expect(events.some((event) => payloadField(event, 'type') === 'item.started')).toBe(true)
    expect(events.some((event) => payloadField(event, 'type') === 'item.completed')).toBe(true)
    expect(stderrText).toBe('codex warning')
    expect(stderrText).not.toContain('TokenRefreshFailed')
    expect(stderrText).not.toContain('Reading additional input')
    expect(events.some((event) => event.type === 'session-complete')).toBe(true)
  })

  it('dispatches OpenCode with run model args', async () => {
    process.env.OPENCODE_COMMAND = opencodeMock
    const adapter = new OpenCodeAdapter()

    expect(await adapter.isInstalled()).toBe(true)

    const session = await adapter.dispatch({
      sessionId: 'opencode-session',
      prompt: 'Summarize this repo',
      repoPath: process.cwd(),
      model: 'minimax-coding-plan/MiniMax-M2.5',
    })
    const events = await collectEvents(session)
    const stdout = events.find((event) => event.type === 'stdout')
    const complete = events.find((event) => event.type === 'session-complete')

    expect(payloadField(stdout, 'argv')).toEqual(
      expect.arrayContaining([
        'run',
        '--format',
        'json',
        '--dangerously-skip-permissions',
        '--model',
        'minimax-coding-plan/MiniMax-M2.5',
      ]),
    )
    expect(events.some((event) => event.type === 'stderr')).toBe(true)
    expect(events.some((event) => event.type === 'session-complete')).toBe(true)
    expect(payloadField(complete, 'usage')).toMatchObject({
      input_tokens: 8,
      output_tokens: 6,
    })
    expect(payloadField(complete, 'cost_usd')).toBe(0.0002)
  })

  it('buffers fast OpenCode completion events until the session manager subscribes', async () => {
    process.env.OPENCODE_COMMAND = opencodeMock
    process.env.OPENCODE_MOCK_IMMEDIATE = '1'
    const adapter = new OpenCodeAdapter()

    const session = await adapter.dispatch({
      sessionId: 'opencode-fast-session',
      prompt: 'Summarize this repo',
      repoPath: process.cwd(),
      model: 'minimax-coding-plan/MiniMax-M2.5',
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    const events = await collectEvents(session)

    expect(events.some((event) => payloadText(event) === 'Hello from OpenCode mock')).toBe(true)
    expect(events.some((event) => event.type === 'session-complete')).toBe(true)
  })

  it('keeps OpenCode step_finish output from ending the session early', async () => {
    process.env.OPENCODE_COMMAND = opencodeMock
    process.env.OPENCODE_MOCK_STEP_FINISH = '1'
    const adapter = new OpenCodeAdapter()

    const session = await adapter.dispatch({
      sessionId: 'opencode-step-finish-session',
      prompt: 'Summarize this repo',
      repoPath: process.cwd(),
      model: 'minimax-coding-plan/MiniMax-M2.5',
    })
    const events = await collectEvents(session)

    const stdoutEvents = events.filter((event) => event.type === 'stdout')
    const stepFinishIndex = stdoutEvents.findIndex(
      (event) => payloadField(event, 'type') === 'step_finish',
    )
    const textIndex = stdoutEvents.findIndex(
      (event) => payloadText(event) === 'Hello from OpenCode mock',
    )

    expect(stepFinishIndex).toBeGreaterThanOrEqual(0)
    expect(textIndex).toBeGreaterThan(stepFinishIndex)
    expect(events.filter((event) => event.type === 'session-complete')).toHaveLength(1)
  })
})

async function collectEvents(session: AgentSession): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []

  session.events.on('event', (event: AgentEvent) => {
    events.push(event)
  })

  await waitFor(() =>
    events.some((event) => event.type === 'session-complete' || event.type === 'error'),
  )
  return events
}

function payloadField(event: AgentEvent | undefined, field: string): unknown {
  if (!event || typeof event.payload !== 'object' || event.payload === null) return undefined

  return (event.payload as Record<string, unknown>)[field]
}

function payloadText(event: AgentEvent | undefined): unknown {
  const part = payloadField(event, 'part')
  if (part && typeof part === 'object' && 'text' in part) {
    return (part as Record<string, unknown>).text
  }

  return payloadField(event, 'text')
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now()

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for adapter session')
    }

    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
