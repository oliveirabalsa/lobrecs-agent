import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { processPool } from '../process/ProcessPool'
import { commandExists, resolveCommand, withContext } from './command'
import type { AgentAdapter, AgentDispatchParams, AgentSession } from './AgentAdapter'
import type { AgentEvent } from '../../shared/types'

const ANTIGRAVITY_COMMAND_ENV = 'ANTIGRAVITY_COMMAND'

interface AntigravityParserState {
  completionUsage?: AntigravityCompletionUsage
}

interface AntigravityCompletionUsage {
  usage: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    cache_read_tokens?: number
    cache_write_tokens?: number
  }
  cost_usd?: number
}

export class AntigravityAdapter implements AgentAdapter {
  readonly id = 'antigravity'
  readonly name = 'Antigravity CLI'

  async isInstalled(): Promise<boolean> {
    return commandExists(resolveCommand(ANTIGRAVITY_COMMAND_ENV, 'agy'))
  }

  async dispatch(params: AgentDispatchParams): Promise<AgentSession> {
    const events = createBufferedEventEmitter()
    const parserState: AntigravityParserState = {}
    let completed = false
    const emitEvent = (event: AgentEvent): void => {
      if (event.type === 'session-complete' || event.type === 'error') completed = true
      events.emitBuffered(event)
    }

    const prompt = withContext(params.prompt, params.context)
    const command = resolveCommand(
      ANTIGRAVITY_COMMAND_ENV,
      'agy',
      params.runtimeSettings?.command,
    )
    const args = [
      '--add-dir',
      params.repoPath,
      ...permissionArgs(params.runtimeSettings?.permissionMode),
      ...(params.runtimeSettings?.extraArgs ?? []),
      '--print',
      // AGY currently exposes model selection through CLI settings and /model,
      // not a supported per-run launch flag.
      prompt,
    ]

    try {
      if (!(await commandExists(command))) {
        emitEvent({
          type: 'error',
          sessionId: params.sessionId,
          payload: {
            message: antigravityCommandMissingMessage(command),
          },
          timestamp: Date.now(),
        } satisfies AgentEvent)
        return createIdleSession(params.sessionId, events)
      }

      const child = processPool.spawn(params.sessionId, command, args, {
        cwd: params.repoPath,
        stdin: 'ignore',
      })

      child.once('error', (error) => {
        emitEvent({
          type: 'error',
          sessionId: params.sessionId,
          payload: {
            message: antigravitySpawnErrorMessage(command, error),
          },
          timestamp: Date.now(),
        } satisfies AgentEvent)
      })

      if (child.stdout) {
        const rl = createInterface({ input: child.stdout })
        rl.on('line', (line) => {
          emitEvent(parseAntigravityLine(line, params.sessionId, parserState))
        })
      }

      child.stderr?.on('data', (chunk: Buffer) => {
        emitEvent({
          type: 'stderr',
          sessionId: params.sessionId,
          payload: { text: chunk.toString() },
          timestamp: Date.now(),
        } satisfies AgentEvent)
      })

      child.on('exit', (code, signal) => {
        if (completed) return

        emitEvent({
          type: 'session-complete',
          sessionId: params.sessionId,
          payload: completionPayload(code, signal, parserState),
          timestamp: Date.now(),
        } satisfies AgentEvent)
      })
    } catch (error) {
      emitEvent({
        type: 'error',
        sessionId: params.sessionId,
        payload: { message: error instanceof Error ? error.message : String(error) },
        timestamp: Date.now(),
      } satisfies AgentEvent)
    }

    return {
      sessionId: params.sessionId,
      events,
      approve: () => undefined,
      reject: () => undefined,
      cancel: () => processPool.kill(params.sessionId),
    }
  }
}

function createIdleSession(
  sessionId: string,
  events: EventEmitter,
): AgentSession {
  return {
    sessionId,
    events,
    approve: () => undefined,
    reject: () => undefined,
    cancel: () => undefined,
  }
}

function antigravityCommandMissingMessage(command: string): string {
  return [
    `Antigravity CLI not found: ${command}.`,
    'Install or configure the `agy` executable, make sure it is on PATH,',
    'or set ANTIGRAVITY_COMMAND / the Antigravity runtime command in Settings.',
  ].join(' ')
}

function antigravitySpawnErrorMessage(command: string, error: Error): string {
  return `Failed to start Antigravity CLI (${command}): ${error.message}`
}

function permissionArgs(permissionMode = 'dangerous'): string[] {
  if (permissionMode === 'read-only') return ['--sandbox']
  if (permissionMode === 'dangerous' || permissionMode === 'bypass-permissions') {
    return ['--dangerously-skip-permissions']
  }

  return []
}

function parseAntigravityLine(
  line: string,
  sessionId: string,
  state?: AntigravityParserState,
): AgentEvent {
  try {
    const data = JSON.parse(line) as Record<string, unknown>
    const type = stringField(data, 'type') ?? stringField(data, 'event') ?? ''

    if (type === 'error') {
      return {
        type: 'stderr',
        sessionId,
        payload: data,
        timestamp: Date.now(),
      }
    }

    if (type === 'result') {
      const usage = antigravityCompletionUsage(data)
      if (usage && state) {
        state.completionUsage = usage
      }

      return {
        type: 'session-complete',
        sessionId,
        payload: usage ? { ...data, ...usage } : data,
        timestamp: Date.now(),
      }
    }

    return {
      type: 'stdout',
      sessionId,
      payload: data,
      timestamp: Date.now(),
    }
  } catch {
    return {
      type: 'stdout',
      sessionId,
      payload: { text: `${line}\n` },
      timestamp: Date.now(),
    }
  }
}

function completionPayload(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  state: AntigravityParserState,
): Record<string, unknown> {
  return state.completionUsage
    ? { exitCode, signal, ...state.completionUsage }
    : { exitCode, signal }
}

function antigravityCompletionUsage(
  data: Record<string, unknown>,
): AntigravityCompletionUsage | undefined {
  const stats = recordField(data, 'stats')
  const usage = sumTokenSources([
    recordField(data, 'usage'),
    recordField(data, 'usageMetadata'),
    recordField(stats, 'usage'),
    recordField(stats, 'usageMetadata'),
    ...antigravityModelStats(stats).flatMap((modelStats) => [
      recordField(modelStats, 'tokens'),
      recordField(modelStats, 'usage'),
      recordField(modelStats, 'usageMetadata'),
      modelStats,
    ]),
  ])
  const costUsd =
    numberField(data, 'cost_usd') ??
    numberField(data, 'costUsd') ??
    numberField(stats, 'cost_usd') ??
    numberField(stats, 'costUsd') ??
    numberField(stats, 'cost')
  const hasUsage = Object.values(usage).some((value) => value !== undefined)

  if (!hasUsage && costUsd === undefined) return undefined
  return costUsd === undefined ? { usage } : { usage, cost_usd: costUsd }
}

function antigravityModelStats(
  stats: Record<string, unknown> | undefined,
): Record<string, unknown>[] {
  const models = stats?.models
  if (Array.isArray(models)) {
    return models.filter(isRecord)
  }

  if (isRecord(models)) {
    return Object.values(models).filter(isRecord)
  }

  return []
}

function sumTokenSources(
  sources: Array<Record<string, unknown> | undefined>,
): AntigravityCompletionUsage['usage'] {
  const usage: AntigravityCompletionUsage['usage'] = {}

  for (const source of sources) {
    if (!source) continue
    addTokenUsage(usage, usageFromTokenRecord(source))
  }

  if (
    usage.output_tokens === undefined &&
    usage.total_tokens !== undefined &&
    usage.input_tokens !== undefined
  ) {
    usage.output_tokens = Math.max(0, usage.total_tokens - usage.input_tokens)
  }

  if (
    usage.input_tokens === undefined &&
    usage.total_tokens !== undefined &&
    usage.output_tokens !== undefined
  ) {
    usage.input_tokens = Math.max(0, usage.total_tokens - usage.output_tokens)
  }

  return usage
}

function addTokenUsage(
  target: AntigravityCompletionUsage['usage'],
  source: AntigravityCompletionUsage['usage'],
): void {
  addNumber(target, 'input_tokens', source.input_tokens)
  addNumber(target, 'output_tokens', source.output_tokens)
  addNumber(target, 'total_tokens', source.total_tokens)
  addNumber(target, 'cache_read_tokens', source.cache_read_tokens)
  addNumber(target, 'cache_write_tokens', source.cache_write_tokens)
}

function usageFromTokenRecord(
  record: Record<string, unknown>,
): AntigravityCompletionUsage['usage'] {
  const candidates = firstNumber(record, ['candidatesTokenCount', 'candidates_tokens', 'candidates'])
  const thoughts = firstNumber(record, ['thoughtsTokenCount', 'thought_tokens', 'thoughts'])
  const outputTokens =
    firstNumber(record, ['output_tokens', 'outputTokens', 'completion_tokens', 'output']) ??
    sumOptionalNumbers(candidates, thoughts)

  return {
    input_tokens: firstNumber(record, [
      'input_tokens',
      'inputTokens',
      'prompt_tokens',
      'promptTokenCount',
      'prompt',
    ]),
    output_tokens: outputTokens,
    total_tokens: firstNumber(record, [
      'total_tokens',
      'totalTokens',
      'totalTokenCount',
      'total',
    ]),
    cache_read_tokens: firstNumber(record, [
      'cache_read_tokens',
      'cacheReadTokens',
      'cachedContentTokenCount',
      'cached_content_token_count',
    ]),
    cache_write_tokens: firstNumber(record, ['cache_write_tokens', 'cacheWriteTokens']),
  }
}

function addNumber(
  target: AntigravityCompletionUsage['usage'],
  key: keyof AntigravityCompletionUsage['usage'],
  value: number | undefined,
): void {
  if (value === undefined) return
  target[key] = (target[key] ?? 0) + value
}

function sumOptionalNumbers(...values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => value !== undefined)
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : undefined
}

function firstNumber(
  object: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = numberField(object, key)
    if (value !== undefined) return value
  }

  return undefined
}

function stringField(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberField(object: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = object?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function recordField(
  object: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = object?.[key]
  return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createBufferedEventEmitter(): EventEmitter & {
  emitBuffered(event: AgentEvent): void
} {
  const events = new EventEmitter() as EventEmitter & {
    emitBuffered(event: AgentEvent): void
  }
  const backlog: AgentEvent[] = []
  let listenerReady = false

  events.on('newListener', (eventName) => {
    if (eventName !== 'event' || listenerReady) return

    listenerReady = true
    queueMicrotask(() => {
      for (const event of backlog.splice(0)) {
        events.emit('event', event)
      }
    })
  })

  events.emitBuffered = (event: AgentEvent): void => {
    if (!listenerReady) {
      backlog.push(event)
      return
    }

    events.emit('event', event)
  }

  return events
}
