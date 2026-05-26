import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { processPool } from '../process/ProcessPool'
import { commandExists, resolveCommand, runCommandText, withContextAndImages } from './command'
import { createAgentModel, dedupeModels, fallbackModelsForAgent } from './modelDiscovery'
import type { AgentAdapter, AgentDispatchParams, AgentSession } from './AgentAdapter'
import type {
  AgentAccountInfo,
  AgentEvent,
  AgentModel,
  AgentPermissionMode,
} from '../../shared/types'

const CURSOR_COMMAND_ENV = 'CURSOR_AGENT_COMMAND'
const CURSOR_MODELS_ENDPOINT = 'https://api.cursor.com/v0/models'
const CURSOR_API_TIMEOUT_MS = 5000
const CURSOR_MODELS_TIMEOUT_MS = 10000
const CURSOR_MODELS_MAX_BUFFER = 512 * 1024
const CURSOR_STATUS_TIMEOUT_MS = 5000
const CURSOR_STATUS_MAX_BUFFER = 64 * 1024
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const MISSING_CURSOR_EMAIL_DETAIL = 'Cursor CLI did not report an account email.'

export class CursorAdapter implements AgentAdapter {
  readonly id = 'cursor'
  readonly name = 'Cursor CLI'

  async isInstalled(): Promise<boolean> {
    return commandExists(resolveCommand(CURSOR_COMMAND_ENV, 'cursor-agent'))
  }

  async listModels(): Promise<AgentModel[]> {
    const command = resolveCommand(CURSOR_COMMAND_ENV, 'cursor-agent')
    const cliModels = await discoverCursorCliModels(command).catch(() => [])
    if (cliModels.length > 0) return cliModels

    const apiKey = process.env.CURSOR_API_KEY?.trim()
    if (apiKey) {
      const apiModels = await fetchCursorApiModels(apiKey).catch(() => [])
      if (apiModels.length > 0) {
        return dedupeModels([...apiModels, ...fallbackModelsForAgent(this.id)])
      }
    }

    return fallbackModelsForAgent(this.id)
  }

  async getAccountInfo(): Promise<AgentAccountInfo> {
    const command = resolveCommand(CURSOR_COMMAND_ENV, 'cursor-agent')

    try {
      const output = await runCommandText(command, ['status'], {
        timeout: CURSOR_STATUS_TIMEOUT_MS,
        maxBuffer: CURSOR_STATUS_MAX_BUFFER,
      })
      const statusInfo = parseCursorStatusOutput(output)

      if (needsCursorAccountEmail(statusInfo)) {
        const aboutInfo = await readCursorAboutInfo(command).catch(() => undefined)
        if (aboutInfo && cursorAccountHasEmail(aboutInfo)) {
          return mergeCursorAccountInfo(statusInfo, aboutInfo)
        }
      }

      return statusInfo
    } catch (error) {
      return {
        status: 'unknown',
        label: 'Status unavailable',
        detail: error instanceof Error ? error.message : 'Cursor status failed.',
      }
    }
  }

  async dispatch(params: AgentDispatchParams): Promise<AgentSession> {
    const events = createBufferedEventEmitter()
    let completed = false
    const emitEvent = (event: AgentEvent): void => {
      if (event.type === 'session-complete' || event.type === 'error') completed = true
      events.emitBuffered(event)
    }

    const prompt = withContextAndImages(params.prompt, params.context, params.imageAttachments)
    const command = resolveCommand(
      CURSOR_COMMAND_ENV,
      'cursor-agent',
      params.runtimeSettings?.command,
    )
    const args = [
      '--print',
      '--output-format',
      'stream-json',
      ...cursorModelArgs(params.model),
      ...cursorForceArgs(params.runtimeSettings?.permissionMode),
      ...(params.runtimeSettings?.extraArgs ?? []),
      prompt,
    ]

    try {
      const child = processPool.spawn(params.sessionId, command, args, {
        cwd: params.repoPath,
        stdin: 'ignore',
      })

      child.once('error', (error) => {
        emitEvent({
          type: 'error',
          sessionId: params.sessionId,
          payload: { message: error.message },
          timestamp: Date.now(),
        } satisfies AgentEvent)
      })

      let readlineDone = !child.stdout
      let stdoutRL: ReturnType<typeof createInterface> | undefined
      if (child.stdout) {
        stdoutRL = createInterface({ input: child.stdout })
        stdoutRL.on('line', (line) => {
          if (!line.trim()) return
          emitEvent(parseCursorLine(line, params.sessionId))
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
            payload: { exitCode: code, signal },
            timestamp: Date.now(),
          } satisfies AgentEvent)
        }
        if (readlineDone) {
          emitFallbackComplete()
        } else {
          stdoutRL!.once('close', emitFallbackComplete)
        }
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

async function discoverCursorCliModels(command: string): Promise<AgentModel[]> {
  const output = await runCommandText(command, ['models'], {
    timeout: CURSOR_MODELS_TIMEOUT_MS,
    maxBuffer: CURSOR_MODELS_MAX_BUFFER,
  })

  return parseCursorCliModels(output)
}

export function parseCursorCliModels(output: string): AgentModel[] {
  const models = output
    .replace(ANSI_PATTERN, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = line.match(/^([^\s]+)\s+-\s+(.+)$/)
      if (!match) return []

      const [, id, label] = match
      return [createAgentModel('cursor', id, 'cli', { label })]
    })

  return dedupeModels(models)
}

export async function fetchCursorApiModels(apiKey: string): Promise<AgentModel[]> {
  if (typeof fetch !== 'function') return []

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CURSOR_API_TIMEOUT_MS)

  try {
    const response = await fetch(CURSOR_MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })

    if (!response.ok) return []
    return parseCursorModelsResponse(await response.json())
  } finally {
    clearTimeout(timeout)
  }
}

export function parseCursorModelsResponse(value: unknown): AgentModel[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { models?: unknown }).models)) {
    return []
  }

  const ids = (value as { models: unknown[] }).models.filter(
    (model): model is string => typeof model === 'string' && model.trim().length > 0,
  )

  return dedupeModels([
    createAgentModel('cursor', 'auto', 'config'),
    ...ids.map((id) => createAgentModel('cursor', id.trim(), 'config')),
  ])
}

export function parseCursorStatusOutput(output: string): AgentAccountInfo {
  const lines = output
    .replace(ANSI_PATTERN, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const text = lines.join('\n')
  const normalized = text.toLowerCase()

  if (
    normalized.includes('not authenticated') ||
    normalized.includes('not logged in') ||
    normalized.includes('logged out')
  ) {
    return {
      status: 'unauthenticated',
      label: 'Not logged in',
      detail: 'Run cursor-agent login to authenticate Cursor CLI.',
    }
  }

  const email = text.match(EMAIL_PATTERN)?.[0]
  const accountLabel = findCursorStatusValue(lines, ['user email', 'email', 'account', 'user'])
  const endpoint = findCursorStatusValue(lines, ['endpoint'])

  if (
    normalized.includes('logged in') ||
    normalized.includes('login successful') ||
    normalized.includes('authenticated') ||
    email ||
    accountLabel
  ) {
    const label = email ?? accountLabel ?? 'Logged in'
    const detail = endpoint
      ? `Endpoint: ${endpoint}`
      : email || accountLabel
        ? undefined
        : MISSING_CURSOR_EMAIL_DETAIL

    return {
      status: 'authenticated',
      label,
      ...(detail ? { detail } : {}),
    }
  }

  return {
    status: 'unknown',
    label: 'Status unknown',
    detail: text || 'Cursor CLI did not return authentication status.',
  }
}

async function readCursorAboutInfo(command: string): Promise<AgentAccountInfo> {
  const output = await runCommandText(command, ['about'], {
    timeout: CURSOR_STATUS_TIMEOUT_MS,
    maxBuffer: CURSOR_STATUS_MAX_BUFFER,
  })

  return parseCursorStatusOutput(output)
}

function needsCursorAccountEmail(info: AgentAccountInfo): boolean {
  return info.status === 'authenticated' && !cursorAccountHasEmail(info)
}

function cursorAccountHasEmail(info: AgentAccountInfo): boolean {
  return EMAIL_PATTERN.test(info.label)
}

function mergeCursorAccountInfo(
  statusInfo: AgentAccountInfo,
  aboutInfo: AgentAccountInfo,
): AgentAccountInfo {
  const detail =
    statusInfo.detail === MISSING_CURSOR_EMAIL_DETAIL
      ? aboutInfo.detail
      : statusInfo.detail ?? aboutInfo.detail

  return {
    ...statusInfo,
    label: aboutInfo.label,
    ...(detail ? { detail } : {}),
  }
}

function cursorModelArgs(model: string): string[] {
  return model && model !== 'auto' ? ['--model', model] : []
}

export function cursorForceArgs(permissionMode?: AgentPermissionMode): string[] {
  return permissionMode === 'dangerous' || permissionMode === 'bypass-permissions'
    ? ['--force']
    : []
}

export function parseCursorLine(line: string, sessionId: string): AgentEvent {
  try {
    const data = JSON.parse(line) as Record<string, unknown>
    const type = typeof data.type === 'string' ? data.type : ''

    if (
      type === 'result' ||
      type === 'complete' ||
      type === 'completion' ||
      type === 'done' ||
      type === 'session-complete' ||
      type === 'session_complete'
    ) {
      return {
        type: 'session-complete',
        sessionId,
        payload: data.is_error === true ? { ...data, exitCode: 1 } : data,
        timestamp: Date.now(),
      }
    }

    if (type.includes('error')) {
      return {
        type: 'error',
        sessionId,
        payload: data,
        timestamp: Date.now(),
      }
    }

    const text = cursorTextFromPayload(data)
    return {
      type: 'stdout',
      sessionId,
      payload: text ? { ...data, text } : data,
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

function cursorTextFromPayload(data: Record<string, unknown>): string | undefined {
  const directText = stringField(data, 'text') ?? stringField(data, 'delta')
  if (directText) return directText

  const message = recordField(data, 'message')
  const messageText = message ? cursorContentText(message.content) : undefined
  if (messageText) return messageText

  return cursorContentText(data.content)
}

function cursorContentText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined

  const text = content
    .map((item) => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return ''
      const record = item as Record<string, unknown>
      return typeof record.text === 'string' ? record.text : ''
    })
    .join('')

  return text || undefined
}

function stringField(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key]
  return typeof value === 'string' ? value : undefined
}

function recordField(
  object: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = object[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function findCursorStatusValue(lines: readonly string[], labels: readonly string[]): string | undefined {
  for (const line of lines) {
    for (const label of labels) {
      const match = line.match(new RegExp(`^[-*\\s]*(?:${escapeRegExp(label)})\\s*:?\\s*(.+)$`, 'i'))
      const value = match?.[1]?.trim()
      if (value) return value
    }
  }

  return undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
