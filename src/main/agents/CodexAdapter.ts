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
    const models = uniqueModels([params.model, ...(params.modelFallbacks ?? [])])
    let modelIndex = 0
    let retryAfterExit = false
    let completed = false
    const emitEvent = (event: AgentEvent): void => {
      if (event.type === 'session-complete' || event.type === 'error') completed = true
      events.emit('event', event)
    }

    const scheduleCapacityRetry = (reason: unknown): boolean => {
      const nextModel = models[modelIndex + 1]
      if (!nextModel) return false

      modelIndex += 1
      retryAfterExit = true
      events.emit('event', {
        type: 'activity',
        sessionId: params.sessionId,
        payload: {
          kind: 'step',
          title: 'Model at capacity',
          detail: `${capacityReasonText(reason)} Retrying with ${nextModel}.`,
          status: 'running',
        },
        timestamp: Date.now(),
      } satisfies AgentEvent)
      return true
    }

    const startCurrentModel = (): void => {
      try {
        const prompt = withContextAndImages(params.prompt, params.context, params.imageAttachments)
        const command = resolveCommand(
          CODEX_COMMAND_ENV,
          'codex',
          params.runtimeSettings?.command,
        )
        const model = models[modelIndex] ?? params.model
        let capacityStderr: string | null = null
        const imageArgs = (params.imageAttachments ?? []).flatMap((image) => [
          '--image',
          image.filePath,
        ])
        const args = [
          'exec',
          '--model',
          model,
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
            if (retryAfterExit) return

            const event = parseCodexLine(line, params.sessionId)
            if (isCapacityFailureEvent(event) && scheduleCapacityRetry(event.payload)) return

            emitEvent(event)
          })
        }

        child.stderr?.on('data', (chunk: Buffer) => {
          const text = visibleCodexStderr(chunk.toString())
          if (!text) return
          if (retryAfterExit) return
          if (isCapacityFailureText(text)) {
            capacityStderr = text
          }

          emitEvent({
            type: 'stderr',
            sessionId: params.sessionId,
            payload: { text },
            timestamp: Date.now(),
          } satisfies AgentEvent)
        })

        child.on('exit', (code, signal) => {
          if (retryAfterExit) {
            retryAfterExit = false
            startCurrentModel()
            return
          }
          if (code && capacityStderr && scheduleCapacityRetry(capacityStderr)) {
            retryAfterExit = false
            startCurrentModel()
            return
          }
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
    }

    setImmediate(() => {
      startCurrentModel()
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

function uniqueModels(models: readonly string[]): string[] {
  return models.filter((model, index) => model.trim() && models.indexOf(model) === index)
}

function isCapacityFailureEvent(event: AgentEvent): boolean {
  return (
    (event.type === 'error' || event.type === 'session-complete') &&
    isCapacityFailureText(capacityReasonText(event.payload))
  )
}

function isCapacityFailureText(text: string): boolean {
  const normalized = text.toLowerCase()
  return (
    normalized.includes('model is at capacity') ||
    normalized.includes('selected model is at capacity') ||
    normalized.includes('model capacity') ||
    normalized.includes('capacity exceeded')
  )
}

function capacityReasonText(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (!payload || typeof payload !== 'object') return String(payload)

  const record = payload as Record<string, unknown>
  const candidates = [
    record.message,
    record.error,
    record.detail,
    record.reason,
    record.result,
    record.text,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }

  return JSON.stringify(payload)
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
    line.includes('codex_memories_write::phase2') ||
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
