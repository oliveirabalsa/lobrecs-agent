import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { processPool } from '../process/ProcessPool'
import { commandExists, resolveCommand, withContext } from './command'
import {
  dedupeModels,
  fallbackModelsForAgent,
  readClaudeHistoryModels,
} from './modelDiscovery'
import type { AgentAdapter, AgentDispatchParams, AgentSession } from './AgentAdapter'
import type { AgentEvent, AgentModel } from '../../shared/types'

const CLAUDE_COMMAND_ENV = 'CLAUDE_COMMAND'

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = 'claude-code'
  readonly name = 'Claude Code'
  private modelsPromise: Promise<AgentModel[]> | null = null

  async isInstalled(): Promise<boolean> {
    return commandExists(resolveCommand(CLAUDE_COMMAND_ENV, 'claude'))
  }

  async listModels(): Promise<AgentModel[]> {
    this.modelsPromise ??= this.discoverModels()
    return this.modelsPromise
  }

  async dispatch(params: AgentDispatchParams): Promise<AgentSession> {
    const events = new EventEmitter()
    let completed = false
    const emitEvent = (event: AgentEvent): void => {
      if (event.type === 'session-complete') completed = true
      events.emit('event', event)
    }
    const prompt = withContext(params.prompt, params.context)
    const command = resolveCommand(CLAUDE_COMMAND_ENV, 'claude')
    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model',
      params.model,
      '--dangerously-skip-permissions',
      prompt,
    ]

    const child = processPool.spawn(params.sessionId, command, args, {
      cwd: params.repoPath,
      env: { CLAUDE_PROMPT: prompt },
      stdin: 'ignore',
    })

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        if (!line.trim()) return

        for (const event of parseClaudeLine(line, params.sessionId)) {
          emitEvent(event)
        }
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
        payload: { exitCode: code, signal },
        timestamp: Date.now(),
      } satisfies AgentEvent)
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
    return dedupeModels([
      ...fallbackModelsForAgent(this.id),
      ...(await readClaudeHistoryModels()),
    ])
  }
}

function parseClaudeLine(line: string, sessionId: string): AgentEvent[] {
  try {
    return mapClaudeOutputToEvents(JSON.parse(line) as Record<string, unknown>, sessionId)
  } catch {
    return [
      {
        type: 'stdout',
        sessionId,
        payload: { text: `${line}\n` },
        timestamp: Date.now(),
      },
    ]
  }
}

function mapClaudeOutputToEvents(
  data: Record<string, unknown>,
  sessionId: string,
): AgentEvent[] {
  if (data.type === 'stream_event') {
    return mapClaudeStreamEvent(data, sessionId)
  }

  if (data.type === 'assistant') {
    return []
  }

  if (data.type === 'result') {
    const events: AgentEvent[] = []
    const visibleText = typeof data.result === 'string' ? data.result : ''

    if ((data.subtype === 'error' || data.is_error === true) && visibleText.trim()) {
      events.push({
        type: 'stderr',
        sessionId,
        payload: { text: visibleText.endsWith('\n') ? visibleText : `${visibleText}\n` },
        timestamp: Date.now(),
      })
    }

    events.push({
      type: 'session-complete',
      sessionId,
      payload: {
        ...data,
        exitCode: data.subtype === 'error' || data.is_error === true ? 1 : 0,
      },
      timestamp: Date.now(),
    })

    return events
  }

  if (data.type === 'error') {
    return [
      {
        type: 'error',
        sessionId,
        payload: data,
        timestamp: Date.now(),
      },
    ]
  }

  return []
}

function mapClaudeStreamEvent(
  data: Record<string, unknown>,
  sessionId: string,
): AgentEvent[] {
  const event = objectPayload(data.event)
  const delta = objectPayload(event.delta)

  if (event.type === 'content_block_delta' && delta.type === 'text_delta') {
    const text = typeof delta.text === 'string' ? delta.text : ''
    if (!text) return []

    return [
      {
        type: 'stdout',
        sessionId,
        payload: { text },
        timestamp: Date.now(),
      },
    ]
  }

  return []
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
