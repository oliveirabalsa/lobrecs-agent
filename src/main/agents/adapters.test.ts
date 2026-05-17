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
    delete process.env.CODEX_COMMAND
    delete process.env.OPENCODE_COMMAND
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
      model: 'claude-sonnet-4-6',
      context: 'Always use rtk.',
    })
    const events = await collectEvents(session)
    const textDelta = events.find(
      (event) => payloadField(event, 'text') === 'Hello from Claude stream',
    )
    const rawLine = events.find((event) => payloadField(event, 'text') === 'raw claude line\n')
    const stderrText = events
      .filter((event) => event.type === 'stderr')
      .map((event) => payloadField(event, 'text'))
      .join('\n')

    expect(textDelta?.type).toBe('stdout')
    expect(events.some((event) => payloadField(event, 'output') === 'hook noise')).toBe(false)
    expect(events.some((event) => payloadField(event, 'thinking') === 'hidden thinking')).toBe(false)
    expect(stderrText).toContain('--output-format')
    expect(stderrText).toContain('stream-json')
    expect(stderrText).toContain('--verbose')
    expect(stderrText).toContain('Repository instructions:')
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

  it('dispatches Codex and maps approval requests', async () => {
    process.env.CODEX_COMMAND = codexMock
    const adapter = new CodexAdapter()

    expect(await adapter.isInstalled()).toBe(true)

    const session = await adapter.dispatch({
      sessionId: 'codex-session',
      prompt: 'Review the diff',
      repoPath: process.cwd(),
      model: 'gpt-5.2-codex',
    })
    const events = await collectEvents(session)
    const approval = events.find((event) => event.type === 'approval-request')

    expect(approval).toBeDefined()
    expect(payloadField(approval, 'argv')).toEqual(
      expect.arrayContaining([
        'exec',
        '--model',
        'gpt-5.2-codex',
        '--ask-for-approval',
        'untrusted',
      ]),
    )
    expect(events.some((event) => payloadField(event, 'text') === 'plain codex output')).toBe(true)
    expect(events.some((event) => event.type === 'stderr')).toBe(true)
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
      model: 'opencode/minimax-m2.5-free',
    })
    const events = await collectEvents(session)
    const stdout = events.find((event) => event.type === 'stdout')

    expect(payloadField(stdout, 'argv')).toEqual(
      expect.arrayContaining([
        'run',
        '--format',
        'json',
        '--model',
        'opencode/minimax-m2.5-free',
      ]),
    )
    expect(events.some((event) => event.type === 'stderr')).toBe(true)
    expect(events.some((event) => event.type === 'session-complete')).toBe(true)
  })
})

async function collectEvents(session: AgentSession): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []

  session.events.on('event', (event: AgentEvent) => {
    events.push(event)
  })

  await waitFor(() => processPool.get(session.sessionId) === undefined)
  return events
}

function payloadField(event: AgentEvent | undefined, field: string): unknown {
  if (!event || typeof event.payload !== 'object' || event.payload === null) return undefined

  return (event.payload as Record<string, unknown>)[field]
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
