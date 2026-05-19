import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { processPool } from '../process/ProcessPool'
import { commandExists, resolveCommand, runCommandText, withContextAndImages } from './command'
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

    setImmediate(() => {
      try {
        const prompt = withContextAndImages(params.prompt, params.context, params.imageAttachments)
        const command = resolveCommand(
          CODEX_COMMAND_ENV,
          'codex',
          params.runtimeSettings?.command,
        )
        const imageArgs = (params.imageAttachments ?? []).flatMap((image) => [
          '--image',
          image.filePath,
        ])
        const args = [
          'exec',
          '--model',
          params.model,
          ...imageArgs,
          ...dangerousArgs(params.runtimeSettings?.permissionMode),
          '--color',
          'never',
          '--json',
          '--skip-git-repo-check',
          ...(params.runtimeSettings?.extraArgs ?? []),
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
          const text = visibleCodexStderr(chunk.toString())
          if (!text) return

          emitEvent({
            type: 'stderr',
            sessionId: params.sessionId,
            payload: { text },
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
      } catch (error) {
        emitEvent({
          type: 'error',
          sessionId: params.sessionId,
          payload: { message: error instanceof Error ? error.message : String(error) },
          timestamp: Date.now(),
        } satisfies AgentEvent)
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

function dangerousArgs(permissionMode = 'dangerous'): string[] {
  return permissionMode === 'dangerous'
    ? ['--dangerously-bypass-approvals-and-sandbox']
    : []
}

function parseCodexLine(line: string, sessionId: string): AgentEvent {
  try {
    const data = JSON.parse(line) as Record<string, unknown>
    const type = typeof data.type === 'string' ? data.type : ''

    if (
      type === 'approval_request' ||
      type === 'approval-request' ||
      type === 'approval.request'
    ) {
      return {
        type: 'approval-request',
        sessionId,
        payload: data,
        timestamp: Date.now(),
      }
    }

    if (
      type === 'turn_complete' ||
      type === 'turn-complete' ||
      type === 'turn.completed'
    ) {
      return {
        type: 'session-complete',
        sessionId,
        payload: data,
        timestamp: Date.now(),
      }
    }

    if (type === 'error') {
      return {
        type: 'error',
        sessionId,
        payload: data,
        timestamp: Date.now(),
      }
    }

    if (type === 'turn.failed') {
      return {
        type: 'session-complete',
        sessionId,
        payload: { ...data, exitCode: 1 },
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

function visibleCodexStderr(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return false

      return !isCodexInfrastructureNoise(trimmed)
    })
    .join('\n')
}

function isCodexInfrastructureNoise(line: string): boolean {
  return (
    line === 'Reading additional input from stdin...' ||
    line.includes('rmcp::transport::worker') ||
    line.includes('Auth(TokenRefreshFailed') ||
    line.includes('codex_core_plugins::') ||
    line.includes('codex_core_skills::') ||
    line.includes('codex_rmcp_client::') ||
    line.includes('codex_mcp::rmcp_client') ||
    line.includes('stdio_server_launcher') ||
    line.includes('session_startup_prewarm') ||
    line.includes('Model personality requested but model_messages is missing') ||
    line.includes('Cloudflare') ||
    line.includes('chatgpt.com/backend-api/plugins/featured') ||
    line.startsWith('<') ||
    line.startsWith('</') ||
    line.startsWith('{') ||
    line.startsWith('}') ||
    line.startsWith('d=') ||
    line.startsWith('fill=') ||
    line.startsWith('xmlns=') ||
    line.startsWith('viewBox=') ||
    line.includes('challenge-error-text') ||
    line.includes('cf_chl_opt') ||
    line.includes('<html>') ||
    line.includes('<script>')
  )
}
