import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { processPool } from '../process/ProcessPool'
import { commandExists, resolveCommand, runCommandText, withContextAndImages } from './command'
import {
  fallbackModelsForAgent,
  parseOpenCodeModels,
} from './modelDiscovery'
import type { AgentAdapter, AgentDispatchParams, AgentSession } from './AgentAdapter'
import type { AgentEvent, AgentModel } from '../../shared/types'

const OPENCODE_COMMAND_ENV = 'OPENCODE_COMMAND'

interface OpenCodeParserState {
  completionUsage?: OpenCodeCompletionUsage
}

interface OpenCodeCompletionUsage {
  usage: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    cache_read_tokens?: number
    cache_write_tokens?: number
  }
  cost_usd?: number
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode'
  readonly name = 'OpenCode'
  private modelsPromise: Promise<AgentModel[]> | null = null

  async isInstalled(): Promise<boolean> {
    return commandExists(resolveCommand(OPENCODE_COMMAND_ENV, 'opencode'))
  }

  async listModels(): Promise<AgentModel[]> {
    this.modelsPromise ??= this.discoverModels()
    return this.modelsPromise
  }

  async dispatch(params: AgentDispatchParams): Promise<AgentSession> {
    const events = createBufferedEventEmitter()
    const parserState: OpenCodeParserState = {}
    let completed = false
    const emitEvent = (event: AgentEvent): void => {
      if (event.type === 'session-complete') completed = true
      events.emitBuffered(event)
    }
    const prompt = withContextAndImages(params.prompt, params.context, params.imageAttachments)
    const command = resolveCommand(
      OPENCODE_COMMAND_ENV,
      'opencode',
      params.runtimeSettings?.command,
    )
    const args = [
      'run',
      '--format',
      'json',
      ...dangerousArgs(params.runtimeSettings?.permissionMode),
      '--model',
      params.model,
      '--dir',
      params.repoPath,
      ...(params.runtimeSettings?.extraArgs ?? []),
      prompt,
    ]

    const child = processPool.spawn(params.sessionId, command, args, {
      cwd: params.repoPath,
      stdin: 'ignore',
    })

    let readlineDone = !child.stdout
    let stdoutRL: ReturnType<typeof createInterface> | undefined
    if (child.stdout) {
      stdoutRL = createInterface({ input: child.stdout })
      stdoutRL.on('line', (line) => {
        if (!line.trim()) return
        emitEvent(parseOpenCodeLine(line, params.sessionId, parserState))
      })
      stdoutRL.on('close', () => {
        readlineDone = true
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
      const emitFallbackComplete = (): void => {
        if (completed) return
        emitEvent({
          type: 'session-complete',
          sessionId: params.sessionId,
          payload: completionPayload(code, signal, parserState),
          timestamp: Date.now(),
        } satisfies AgentEvent)
      }
      if (readlineDone) {
        emitFallbackComplete()
      } else {
        stdoutRL!.once('close', emitFallbackComplete)
      }
    })

    return {
      sessionId: params.sessionId,
      events,
      approve: () => undefined,
      reject: () => undefined,
      cancel: () => processPool.kill(params.sessionId),
    }
  }

  private async discoverModels(): Promise<AgentModel[]> {
    try {
      const command = resolveCommand(OPENCODE_COMMAND_ENV, 'opencode')
      const output = await runCommandText(command, ['models'], {
        timeout: 7000,
        maxBuffer: 5 * 1024 * 1024,
      })
      const models = parseOpenCodeModels(output)

      // When the CLI reports models, that IS the authoritative list — show it
      // verbatim instead of padding it with hardcoded MODEL_MAP entries that may
      // use a different provider prefix than this install. Only fall back to the
      // built-in list when discovery yields nothing (e.g. CLI not installed).
      return models.length > 0 ? models : fallbackModelsForAgent(this.id)
    } catch {
      return fallbackModelsForAgent(this.id)
    }
  }
}

function dangerousArgs(permissionMode = 'dangerous'): string[] {
  return permissionMode === 'dangerous' ? ['--dangerously-skip-permissions'] : []
}

function parseOpenCodeLine(
  line: string,
  sessionId: string,
  state?: OpenCodeParserState,
): AgentEvent {
  try {
    const data = JSON.parse(line) as Record<string, unknown>
    const type = typeof data.type === 'string' ? data.type : ''
    const completionUsage = openCodeCompletionUsage(data)
    if (completionUsage && state) {
      state.completionUsage = completionUsage
    }

    if (type.includes('error')) {
      return {
        type: 'error',
        sessionId,
        payload: data,
        timestamp: Date.now(),
      }
    }

    if (
      type === 'complete' ||
      type === 'finish' ||
      type === 'result' ||
      type === 'session_complete' ||
      type === 'session_finish' ||
      type === 'session-complete' ||
      type === 'session-finish'
    ) {
      return {
        type: 'session-complete',
        sessionId,
        payload: completionUsage ? { ...data, ...completionUsage } : data,
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
  state: OpenCodeParserState,
): Record<string, unknown> {
  return state.completionUsage
    ? { exitCode, signal, ...state.completionUsage }
    : { exitCode, signal }
}

function openCodeCompletionUsage(
  data: Record<string, unknown>,
): OpenCodeCompletionUsage | undefined {
  const part = recordField(data, 'part')
  const tokens = recordField(part, 'tokens') ?? recordField(data, 'tokens')
  const usage: OpenCodeCompletionUsage['usage'] = {}

  if (tokens) {
    const inputTokens = numberField(tokens, 'input')
    const outputTokens = numberField(tokens, 'output')
    const totalTokens = numberField(tokens, 'total')
    const cache = recordField(tokens, 'cache')
    const cacheReadTokens = cache ? numberField(cache, 'read') : undefined
    const cacheWriteTokens = cache ? numberField(cache, 'write') : undefined

    if (inputTokens !== undefined) usage.input_tokens = inputTokens
    if (outputTokens !== undefined) usage.output_tokens = outputTokens
    if (totalTokens !== undefined) usage.total_tokens = totalTokens
    if (cacheReadTokens !== undefined) usage.cache_read_tokens = cacheReadTokens
    if (cacheWriteTokens !== undefined) usage.cache_write_tokens = cacheWriteTokens
  }

  const costUsd = numberField(part, 'cost') ?? numberField(data, 'cost')
  const hasUsage = Object.keys(usage).length > 0
  if (!hasUsage && costUsd === undefined) return undefined

  return costUsd === undefined ? { usage } : { usage, cost_usd: costUsd }
}

function recordField(
  object: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = object?.[key]
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function numberField(object: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = object?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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
