import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { processPool } from '../process/ProcessPool'
import { commandExists, resolveCommand, runCommandText, withContext } from './command'
import {
  dedupeModels,
  fallbackModelsForAgent,
  parseOpenCodeModels,
} from './modelDiscovery'
import type { AgentAdapter, AgentDispatchParams, AgentSession } from './AgentAdapter'
import type { AgentEvent, AgentModel } from '../../shared/types'

const OPENCODE_COMMAND_ENV = 'OPENCODE_COMMAND'

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
    const events = new EventEmitter()
    let completed = false
    const emitEvent = (event: AgentEvent): void => {
      if (event.type === 'session-complete') completed = true
      events.emit('event', event)
    }
    const prompt = withContext(params.prompt, params.context)
    const command = resolveCommand(OPENCODE_COMMAND_ENV, 'opencode')
    const args = [
      'run',
      '--format',
      'json',
      '--model',
      params.model,
      '--dir',
      params.repoPath,
      prompt,
    ]

    const child = processPool.spawn(params.sessionId, command, args, {
      cwd: params.repoPath,
      stdin: 'ignore',
    })

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        if (!line.trim()) return
        emitEvent(parseOpenCodeLine(line, params.sessionId))
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
    try {
      const command = resolveCommand(OPENCODE_COMMAND_ENV, 'opencode')
      const output = await runCommandText(command, ['models'], {
        timeout: 7000,
        maxBuffer: 5 * 1024 * 1024,
      })
      const models = parseOpenCodeModels(output)

      return models.length > 0
        ? dedupeModels([...models, ...fallbackModelsForAgent(this.id)])
        : fallbackModelsForAgent(this.id)
    } catch {
      return fallbackModelsForAgent(this.id)
    }
  }
}

function parseOpenCodeLine(line: string, sessionId: string): AgentEvent {
  try {
    const data = JSON.parse(line) as Record<string, unknown>
    const type = typeof data.type === 'string' ? data.type : ''

    if (type.includes('error')) {
      return {
        type: 'error',
        sessionId,
        payload: data,
        timestamp: Date.now(),
      }
    }

    if (type.includes('complete') || type.includes('finish')) {
      return {
        type: 'session-complete',
        sessionId,
        payload: data,
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
