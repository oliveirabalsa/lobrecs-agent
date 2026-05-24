import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaudeCodeAdapter } from './ClaudeCodeAdapter'
import { CodexAdapter } from './CodexAdapter'
import { AntigravityAdapter } from './AntigravityAdapter'
import { OpenCodeAdapter } from './OpenCodeAdapter'
import { adapterRegistry } from './index'
import { processPool } from '../process/ProcessPool'
import type { AgentSession } from './AgentAdapter'
import type { AgentEvent } from '../../shared/types'

const claudeMock = fileURLToPath(new URL('./__mocks__/claude-mock.cjs', import.meta.url))
const codexMock = fileURLToPath(new URL('./__mocks__/codex-mock.cjs', import.meta.url))
const antigravityMock = fileURLToPath(new URL('./__mocks__/antigravity-mock.cjs', import.meta.url))
const opencodeMock = fileURLToPath(new URL('./__mocks__/opencode-mock.cjs', import.meta.url))

describe('agent adapters', () => {
  afterEach(() => {
    delete process.env.CLAUDE_COMMAND
    delete process.env.CLAUDE_MOCK_RESULT_MODE
    delete process.env.CLAUDE_MOCK_DUPLICATE_TEXT
    delete process.env.CLAUDE_MOCK_SESSION_END_NOISE
    delete process.env.CLAUDE_MOCK_PLUGIN_WORKER_NOISE
    delete process.env.CLAUDE_MOCK_USER_QUESTION
    delete process.env.CODEX_COMMAND
    delete process.env.CODEX_MOCK_CAPACITY_MODEL
    delete process.env.ANTIGRAVITY_COMMAND
    delete process.env.ANTIGRAVITY_MOCK_MODE
    delete process.env.OPENCODE_COMMAND
    delete process.env.OPENCODE_MOCK_IMMEDIATE
    delete process.env.OPENCODE_MOCK_STEP_FINISH
    processPool.killAll()
  })

  it('registers all supported adapters', () => {
    expect(adapterRegistry.get('claude-code')).toBeInstanceOf(ClaudeCodeAdapter)
    expect(adapterRegistry.get('codex')).toBeInstanceOf(CodexAdapter)
    expect(adapterRegistry.get('opencode')).toBeInstanceOf(OpenCodeAdapter)
    expect(adapterRegistry.get('antigravity')).toBeInstanceOf(AntigravityAdapter)
  })

  // All tests below spawn Unix shebang scripts — EFTYPE on Windows; skip there.
  describe.skipIf(process.platform === 'win32')('process-spawning adapters', () => {

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

  it('does not echo duplicate Claude text from assistant and result records', async () => {
    process.env.CLAUDE_COMMAND = claudeMock
    process.env.CLAUDE_MOCK_DUPLICATE_TEXT = '1'
    const adapter = new ClaudeCodeAdapter()

    const session = await adapter.dispatch({
      sessionId: 'claude-duplicate-session',
      prompt: 'Avoid duplicate text',
      repoPath: process.cwd(),
      model: 'sonnet',
    })
    const events = await collectEvents(session)
    const visibleTexts = events
      .filter((event) => event.type === 'stdout')
      .map((event) => payloadField(event, 'text'))
      .filter((text): text is string => typeof text === 'string')
      .filter((text) => text.trim() === 'Duplicated Claude response')

    expect(visibleTexts).toEqual(['Duplicated Claude response'])
    expect(events.some((event) => event.type === 'session-complete')).toBe(true)
  })

  it('maps Claude user-question tool use into a structured prompt activity', async () => {
    process.env.CLAUDE_COMMAND = claudeMock
    process.env.CLAUDE_MOCK_USER_QUESTION = '1'
    const adapter = new ClaudeCodeAdapter()

    const session = await adapter.dispatch({
      sessionId: 'claude-question-session',
      prompt: 'Ask before continuing',
      repoPath: process.cwd(),
      model: 'sonnet',
    })
    const events = await collectEvents(session)
    const userQuestion = events.find((event) => payloadField(event, 'kind') === 'user-question')

    expect(userQuestion).toMatchObject({
      type: 'activity',
      payload: {
        kind: 'user-question',
        questions: [
          expect.objectContaining({
            question: 'Which files should I focus?',
          }),
        ],
      },
    })
    expect(events.some((event) => payloadField(event, 'output') === 'Answer questions?')).toBe(false)
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
    expect(stderrText).not.toContain('codex_memories_write')
    expect(stderrText).not.toContain('failed to load skill')
    expect(events.some((event) => event.type === 'session-complete')).toBe(true)
  })

  it('applies runtime command and permission settings to Codex dispatch', async () => {
    const adapter = new CodexAdapter()

    const session = await adapter.dispatch({
      sessionId: 'codex-runtime-session',
      prompt: 'Review the diff',
      repoPath: process.cwd(),
      model: 'gpt-5.3-codex',
      runtimeSettings: {
        enabled: true,
        command: codexMock,
        permissionMode: 'ask-for-approval',
        extraArgs: ['-c', 'model_reasoning_effort="xhigh"'],
      },
    })
    const events = await collectEvents(session)
    const argvEvent = events.find((event) => Array.isArray(payloadField(event, 'argv')))
    const argv = payloadField(argvEvent, 'argv')

    expect(argv).toEqual(expect.arrayContaining(['-c', 'model_reasoning_effort="xhigh"']))
    expect(argv).not.toEqual(
      expect.arrayContaining(['--dangerously-bypass-approvals-and-sandbox']),
    )
  })

  it('surfaces Codex capacity errors without silently retrying another model', async () => {
    process.env.CODEX_COMMAND = codexMock
    process.env.CODEX_MOCK_CAPACITY_MODEL = 'gpt-5.5'
    const adapter = new CodexAdapter()

    const session = await adapter.dispatch({
      sessionId: 'codex-capacity-session',
      prompt: 'Review the diff',
      repoPath: process.cwd(),
      model: 'gpt-5.5',
      modelFallbacks: ['gpt-5.4', 'gpt-5.3-codex'],
    })
    const events = await collectEvents(session)
    const error = events.find((event) => event.type === 'error')

    expect(payloadField(error, 'message')).toContain('Selected model is at capacity')
    expect(events.some((event) => event.type === 'approval-request')).toBe(false)
    expect(events.some((event) => event.type === 'session-complete')).toBe(false)
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

  it('dispatches Antigravity in print mode and normalizes compatibility result usage', async () => {
    process.env.ANTIGRAVITY_COMMAND = antigravityMock
    const adapter = new AntigravityAdapter()

    expect(await adapter.isInstalled()).toBe(true)

    const session = await adapter.dispatch({
      sessionId: 'antigravity-session',
      prompt: 'Summarize this repo',
      repoPath: process.cwd(),
      model: 'flash',
      context: 'Always use rtk.',
    })
    const events = await collectEvents(session)
    const argvEvent = events.find((event) => Array.isArray(payloadField(event, 'argv')))
    const argv = argvFromEvent(argvEvent)
    const stderr = events.find((event) => event.type === 'stderr')
    const complete = events.find((event) => event.type === 'session-complete')
    const printIndex = argv.indexOf('--print')

    expect(argv).toEqual(expect.arrayContaining(['--print', '--add-dir', process.cwd()]))
    expect(argv).toContain('--dangerously-skip-permissions')
    expect(argv.indexOf('--add-dir')).toBeLessThan(printIndex)
    expect(argv.indexOf('--dangerously-skip-permissions')).toBeLessThan(printIndex)
    expect(argv).not.toContain('pure')
    expect(argv).not.toContain('--model')
    expect(argv).not.toContain('flash')
    expect(argv).not.toContain('--prompt')
    expect(argv).not.toContain('--output-format')
    expect(argv).not.toContain('stream-json')
    expect(argv).not.toContain('--skip-trust')
    expect(argv).not.toContain('--approval-mode')
    expect(argv.at(-1)).toContain('Repository instructions:\nAlways use rtk.')
    expect(argv.at(-1)).toContain('Task:\nSummarize this repo')
    expect(events.some((event) => payloadField(event, 'text') === 'Hello from Antigravity mock\n')).toBe(true)
    expect(events.some((event) => payloadField(event, 'tool_name') === 'shell')).toBe(true)
    expect(payloadField(stderr, 'text')).toContain('antigravity warning')
    expect(payloadField(complete, 'usage')).toMatchObject({
      input_tokens: 11,
      output_tokens: 10,
      total_tokens: 21,
    })
  })

  it('completes Antigravity plain multiline print output on process exit', async () => {
    process.env.ANTIGRAVITY_COMMAND = antigravityMock
    process.env.ANTIGRAVITY_MOCK_MODE = 'plain-only'
    const adapter = new AntigravityAdapter()

    const session = await adapter.dispatch({
      sessionId: 'antigravity-plain-session',
      prompt: 'Print two lines',
      repoPath: process.cwd(),
      model: 'gemini-2.5-flash',
    })
    const events = await collectEvents(session)
    const stdoutTexts = events
      .filter((event) => event.type === 'stdout')
      .map((event) => payloadField(event, 'text'))
      .filter((text): text is string => typeof text === 'string')
    const complete = events.find((event) => event.type === 'session-complete')

    expect(stdoutTexts).toEqual([
      'First Antigravity line\n',
      'Second Antigravity line\n',
    ])
    expect(payloadField(complete, 'exitCode')).toBe(0)
  })

  it('emits Antigravity transcript tool calls when print mode stdout is final text only', async () => {
    process.env.ANTIGRAVITY_COMMAND = antigravityMock
    process.env.ANTIGRAVITY_MOCK_MODE = 'transcript-only'
    const adapter = new AntigravityAdapter()

    const session = await adapter.dispatch({
      sessionId: 'antigravity-transcript-session',
      prompt: 'Run pwd and create a note',
      repoPath: process.cwd(),
      model: 'gemini-3.5-flash',
    })
    const events = await collectEvents(session)
    const argvEvent = events.find((event) => Array.isArray(payloadField(event, 'argv')))
    const argv = argvFromEvent(argvEvent)

    expect(argv).toContain('--log-file')
    expect(events.some((event) => payloadField(event, 'text') === 'Transcript final answer from Antigravity mock\n')).toBe(true)
    expect(
      events.some(
        (event) =>
          event.type === 'stdout' &&
          payloadField(event, 'type') === 'message' &&
          payloadField(event, 'content') === 'I will run pwd and create a note.',
      ),
    ).toBe(true)
    expect(
      events.some(
        (event) => {
          const parameters = payloadField(event, 'parameters')
          return (
            event.type === 'stdout' &&
            payloadField(event, 'type') === 'tool_use' &&
            payloadField(event, 'tool_name') === 'run_command' &&
            isRecord(parameters) &&
            parameters.CommandLine === 'rtk pwd'
          )
        },
      ),
    ).toBe(true)
    expect(
      events.some(
        (event) => {
          const parameters = payloadField(event, 'parameters')
          return (
            event.type === 'stdout' &&
            payloadField(event, 'type') === 'tool_use' &&
            payloadField(event, 'tool_name') === 'write_to_file' &&
            isRecord(parameters) &&
            parameters.TargetFile === '/repo/note.md'
          )
        },
      ),
    ).toBe(true)
    expect(
      events.some(
        (event) =>
          event.type === 'stdout' &&
          payloadField(event, 'type') === 'tool_result' &&
          payloadField(event, 'tool_name') === 'run-command',
      ),
    ).toBe(true)
  })

  it('surfaces a clear error when the Antigravity CLI is missing', async () => {
    const adapter = new AntigravityAdapter()

    const session = await adapter.dispatch({
      sessionId: 'antigravity-missing-session',
      prompt: 'Summarize this repo',
      repoPath: process.cwd(),
      model: 'gemini-2.5-flash',
      runtimeSettings: {
        enabled: true,
        command: '/tmp/lobrecs-agent-missing-agy',
        permissionMode: 'dangerous',
        extraArgs: [],
      },
    })
    const events = await collectEvents(session)
    const error = events.find((event) => event.type === 'error')

    expect(payloadField(error, 'message')).toContain('Antigravity CLI not found')
    expect(payloadField(error, 'message')).toContain('ANTIGRAVITY_COMMAND')
    expect(events.some((event) => event.type === 'session-complete')).toBe(false)
  })

  it.each([
    ['dangerous' as const, ['--dangerously-skip-permissions'], ['--sandbox']],
    ['bypass-permissions' as const, ['--dangerously-skip-permissions'], ['--sandbox']],
    ['read-only' as const, ['--sandbox'], ['--dangerously-skip-permissions']],
    ['ask-for-approval' as const, [], ['--dangerously-skip-permissions', '--sandbox']],
  ])('maps Antigravity %s permission mode to CLI flags', async (permissionMode, expected, forbidden) => {
    const adapter = new AntigravityAdapter()

    const session = await adapter.dispatch({
      sessionId: `antigravity-${permissionMode}-session`,
      prompt: 'Summarize this repo',
      repoPath: process.cwd(),
      model: 'flash',
      runtimeSettings: {
        enabled: true,
        command: antigravityMock,
        permissionMode,
        extraArgs: ['--print-timeout', '10m'],
      },
    })
    const events = await collectEvents(session)
    const argvEvent = events.find((event) => Array.isArray(payloadField(event, 'argv')))
    const argv = argvFromEvent(argvEvent)
    const printIndex = argv.indexOf('--print')

    expect(argv).toEqual(expect.arrayContaining(['--print-timeout', '10m']))
    expect(argv.indexOf('--print-timeout')).toBeLessThan(printIndex)
    for (const flag of expected) {
      expect(argv).toContain(flag)
      expect(argv.indexOf(flag)).toBeLessThan(printIndex)
    }
    for (const flag of forbidden) {
      expect(argv).not.toContain(flag)
    }
  })

  }) // end describe.skipIf win32
})

async function collectEvents(session: AgentSession): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []

  session.events.on('event', (event: AgentEvent) => {
    events.push(event)
  })

  await waitFor(() =>
    events.some((event) => event.type === 'session-complete' || event.type === 'error'),
  )
  await waitFor(() => processPool.get(session.sessionId) === undefined)
  await new Promise((resolve) => setTimeout(resolve, 20))
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

function argvFromEvent(event: AgentEvent | undefined): string[] {
  const argv = payloadField(event, 'argv')
  return Array.isArray(argv) && argv.every((item) => typeof item === 'string') ? argv : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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
