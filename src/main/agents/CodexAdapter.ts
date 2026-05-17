import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { processPool } from '../process/ProcessPool'
import { commandExists, resolveCommand, runCommandText, withContext } from './command'
import {
  dedupeModels,
  fallbackModelsForAgent,
  parseCodexModels,
} from './modelDiscovery'
import type { AgentAdapter, AgentDispatchParams, AgentSession } from './AgentAdapter'
import type { AgentEvent, AgentModel } from '../../shared/types'

const CODEX_COMMAND_ENV = 'CODEX_COMMAND'

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex'
  readonly name = 'OpenAI Codex'
  private modelsPromise: Promise<AgentModel[]> | null = null

  async isInstalled(): Promise<boolean> {
    return commandExists(resolveCommand(CODEX_COMMAND_ENV, 'codex'))
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
    const command = resolveCommand(CODEX_COMMAND_ENV, 'codex')
    const args = [
      'exec',
      '--model',
      params.model,
      '--dangerously-bypass-approvals-and-sandbox',
      '--color',
      'never',
      '--json',
      '--skip-git-repo-check',
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

        emitEvent(parseCodexLine(line, params.sessionId))
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
      const command = resolveCommand(CODEX_COMMAND_ENV, 'codex')
      const output = await runCommandText(command, ['debug', 'models'], {
        timeout: 5000,
        maxBuffer: 10 * 1024 * 1024,
      })
      const models = parseCodexModels(output)

      return models.length > 0
        ? dedupeModels([...models, ...fallbackModelsForAgent(this.id)])
        : fallbackModelsForAgent(this.id)
    } catch {
      return fallbackModelsForAgent(this.id)
    }
  }
}

function parseCodexLine(line: string, sessionId: string): AgentEvent {
  try {
    const data = JSON.parse(line) as Record<string, unknown>

    if (
      data.type === 'approval_request' ||
      data.type === 'approval-request' ||
      data.type === 'approval.request'
    ) {
      return {
        type: 'approval-request',
        sessionId,
        payload: data,
        timestamp: Date.now(),
      }
    }

    if (
      data.type === 'turn_complete' ||
      data.type === 'turn-complete' ||
      data.type === 'turn.completed'
    ) {
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
      payload: { text: line },
      timestamp: Date.now(),
    }
  }
}
