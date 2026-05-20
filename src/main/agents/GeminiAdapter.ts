import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { processPool } from '../process/ProcessPool'
import { commandExists, resolveCommand, withContext } from './command'
import type { AgentAdapter, AgentDispatchParams, AgentSession } from './AgentAdapter'
import type { AgentEvent } from '../../shared/types'

const GEMINI_COMMAND_ENV = 'GEMINI_COMMAND'

interface GeminiParserState {
  completionUsage?: GeminiCompletionUsage
}

interface GeminiCompletionUsage {
  usage: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    cache_read_tokens?: number
    cache_write_tokens?: number
  }
  cost_usd?: number
}

export class GeminiAdapter implements AgentAdapter {
  readonly id = 'gemini'
  readonly name = 'Gemini CLI'

  async isInstalled(): Promise<boolean> {
    return commandExists(resolveCommand(GEMINI_COMMAND_ENV, 'gemini'))
  }

  async dispatch(params: AgentDispatchParams): Promise<AgentSession> {
    const events = createBufferedEventEmitter()
    const parserState: GeminiParserState = {}
    let completed = false
    const emitEvent = (event: AgentEvent): void => {
      if (event.type === 'session-complete') completed = true
      events.emitBuffered(event)
    }

    const prompt = withContext(params.prompt, params.context)
    const command = resolveCommand(
      GEMINI_COMMAND_ENV,
      'gemini',
      params.runtimeSettings?.command,
    )
    const args = [
      '--model',
      params.model,
      '--prompt',
      prompt,
      '--output-format',
      'stream-json',
      '--skip-trust',
      ...approvalModeArgs(params.runtimeSettings?.permissionMode),
      ...(params.runtimeSettings?.extraArgs ?? []),
    ]

    try {
      const child = processPool.spawn(params.sessionId, command, args, {
        cwd: params.repoPath,
        stdin: 'ignore',
      })

      if (child.stdout) {
        const rl = createInterface({ input: child.stdout })
        rl.on('line', (line) => {
          if (!line.trim()) return
          emitEvent(parseGeminiLine(line, params.sessionId, parserState))
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

function approvalModeArgs(permissionMode = 'dangerous'): string[] {
  const approvalMode =
    permissionMode === 'read-only'
      ? 'plan'
      : permissionMode === 'ask-for-approval'
        ? 'default'
        : 'yolo'

  return ['--approval-mode', approvalMode]
}

function parseGeminiLine(
  line: string,
  sessionId: string,
  state?: GeminiParserState,
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
      const usage = geminiCompletionUsage(data)
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
  state: GeminiParserState,
): Record<string, unknown> {
  return state.completionUsage
    ? { exitCode, signal, ...state.completionUsage }
    : { exitCode, signal }
}

function geminiCompletionUsage(
  data: Record<string, unknown>,
): GeminiCompletionUsage | undefined {
  const stats = recordField(data, 'stats')
  const usage = sumTokenSources([
    recordField(data, 'usage'),
    recordField(data, 'usageMetadata'),
    recordField(stats, 'usage'),
    recordField(stats, 'usageMetadata'),
    ...geminiModelStats(stats).flatMap((modelStats) => [
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

function geminiModelStats(
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
): GeminiCompletionUsage['usage'] {
  const usage: GeminiCompletionUsage['usage'] = {}

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
  target: GeminiCompletionUsage['usage'],
  source: GeminiCompletionUsage['usage'],
): void {
  addNumber(target, 'input_tokens', source.input_tokens)
  addNumber(target, 'output_tokens', source.output_tokens)
  addNumber(target, 'total_tokens', source.total_tokens)
  addNumber(target, 'cache_read_tokens', source.cache_read_tokens)
  addNumber(target, 'cache_write_tokens', source.cache_write_tokens)
}

function usageFromTokenRecord(
  record: Record<string, unknown>,
): GeminiCompletionUsage['usage'] {
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
  target: GeminiCompletionUsage['usage'],
  key: keyof GeminiCompletionUsage['usage'],
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
