import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { processPool } from '../process/ProcessPool'
import { commandExists, resolveCommand, withContextAndImages } from './command'
import {
  dedupeModels,
  fallbackModelsForAgent,
  readClaudeHistoryModels,
} from './modelDiscovery'
import { isClaudeSessionEndHookWarning } from '../../shared/contracts/agentOutput'
import type { AgentAdapter, AgentDispatchParams, AgentSession } from './AgentAdapter'
import type { AgentActivity, AgentEvent, AgentModel } from '../../shared/types'

const CLAUDE_COMMAND_ENV = 'CLAUDE_COMMAND'
const CLAUDE_MODEL_ALIASES: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
}

type ClaudeParserState = {
  startupHooksShown: boolean
  toolNamesById: Map<string, string>
}

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
    const events = createBufferedEventEmitter()
    const parserState: ClaudeParserState = {
      startupHooksShown: false,
      toolNamesById: new Map(),
    }
    let completed = false
    const emitEvent = (event: AgentEvent): void => {
      if (event.type === 'session-complete' || event.type === 'error') completed = true
      events.emitBuffered(event)
    }
    const prompt = withContextAndImages(params.prompt, params.context, params.imageAttachments)
    const command = resolveCommand(
      CLAUDE_COMMAND_ENV,
      'claude',
      params.runtimeSettings?.command,
    )
    const model = normalizeClaudeModelId(params.model)
    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--input-format',
      'text',
      '--verbose',
      '--include-partial-messages',
      ...claudePermissionArgs(params.runtimeSettings?.permissionMode),
      '--model',
      model,
      ...dangerousArgs(params.runtimeSettings?.permissionMode),
      ...(params.runtimeSettings?.extraArgs ?? []),
      prompt,
    ]
    let sawProcessOutput = false
    const noOutputTimer = setTimeout(() => {
      emitActivity(emitEvent, params.sessionId, {
        kind: 'step',
        title: 'Waiting for Claude Code output',
        detail: 'The Claude process is running but has not emitted CLI output yet.',
        status: 'running',
      })
    }, 12_000)
    noOutputTimer.unref?.()
    const markProcessOutput = (): void => {
      if (sawProcessOutput) return

      sawProcessOutput = true
      clearTimeout(noOutputTimer)
    }

    emitActivity(emitEvent, params.sessionId, {
      kind: 'step',
      title: 'Starting Claude Code',
      detail: model,
      status: 'running',
    })

    const child = processPool.spawn(params.sessionId, command, args, {
      cwd: params.repoPath,
      env: { CLAUDE_PROMPT: prompt },
      stdin: 'ignore',
    })

    child.on('error', (error) => {
      clearTimeout(noOutputTimer)
      emitEvent({
        type: 'error',
        sessionId: params.sessionId,
        payload: { message: error.message },
        timestamp: Date.now(),
      } satisfies AgentEvent)
    })

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        if (!line.trim()) return

        markProcessOutput()
        for (const event of parseClaudeLine(line, params.sessionId, parserState)) {
          emitEvent(event)
        }
      })
    }

    child.stderr?.on('data', (chunk: Buffer) => {
      markProcessOutput()
      const text = visibleClaudeStderr(chunk.toString())
      if (!text.trim()) return

      emitEvent({
        type: 'stderr',
        sessionId: params.sessionId,
        payload: { text },
        timestamp: Date.now(),
      } satisfies AgentEvent)
    })

    child.on('exit', (code, signal) => {
      clearTimeout(noOutputTimer)
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

function claudePermissionArgs(permissionMode = 'dangerous'): string[] {
  if (permissionMode === 'dangerous' || permissionMode === 'bypass-permissions') {
    return ['--permission-mode', 'bypassPermissions']
  }

  return []
}

function dangerousArgs(permissionMode = 'dangerous'): string[] {
  return permissionMode === 'dangerous' ? ['--dangerously-skip-permissions'] : []
}

function parseClaudeLine(
  line: string,
  sessionId: string,
  state: ClaudeParserState,
): AgentEvent[] {
  try {
    return mapClaudeOutputToEvents(JSON.parse(line) as Record<string, unknown>, sessionId, state)
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
  state: ClaudeParserState,
): AgentEvent[] {
  if (data.type === 'system') {
    return mapClaudeSystemEvent(data, sessionId, state)
  }

  if (data.type === 'stream_event') {
    return mapClaudeStreamEvent(data, sessionId)
  }

  if (data.type === 'assistant') {
    return mapClaudeAssistantMessage(data.message ?? data, sessionId, state)
  }

  if (data.type === 'user') {
    return mapClaudeUserMessage(data.message ?? data, sessionId, state)
  }

  if (data.type === 'result') {
    const events: AgentEvent[] = []
    const visibleText = typeof data.result === 'string' ? data.result : ''

    if (visibleText.trim()) {
      events.push({
        type: data.subtype === 'error' || data.is_error === true ? 'stderr' : 'stdout',
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
        cost_usd:
          typeof data.total_cost_usd === 'number' ? data.total_cost_usd : data.cost_usd,
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

function mapClaudeSystemEvent(
  data: Record<string, unknown>,
  sessionId: string,
  state: ClaudeParserState,
): AgentEvent[] {
  if (data.subtype === 'hook_started' && !state.startupHooksShown) {
    state.startupHooksShown = true
    return [
      activityEvent(sessionId, {
        kind: 'step',
        title: 'Running Claude startup hooks',
        status: 'running',
      }),
    ]
  }

  if (data.subtype === 'init') {
    const model = typeof data.model === 'string' ? data.model : undefined
    const detail = model ? `${model} ready` : undefined

    return [
      activityEvent(sessionId, {
        kind: 'step',
        title: 'Claude Code initialized',
        detail,
        status: 'done',
      }),
    ]
  }

  if (data.subtype === 'status') {
    const status = typeof data.status === 'string' ? data.status : 'working'

    return [
      activityEvent(sessionId, {
        kind: 'step',
        title: status === 'requesting' ? 'Claude Code is thinking' : 'Claude Code status',
        detail: status === 'requesting' ? undefined : status,
        status: status === 'error' ? 'error' : 'running',
      }),
    ]
  }

  return []
}

function mapClaudeAssistantMessage(
  value: unknown,
  sessionId: string,
  state: ClaudeParserState,
): AgentEvent[] {
  const events: AgentEvent[] = []

  for (const item of contentItems(value)) {
    if (item.type === 'tool_use') {
      const id = typeof item.id === 'string' ? item.id : undefined
      const name = typeof item.name === 'string' ? item.name : 'tool'

      if (id) state.toolNamesById.set(id, name)
      events.push(activityEvent(sessionId, {
        kind: 'tool-call',
        name,
        input: item.input,
        status: 'running',
      }))
    }
  }

  const text = textFromClaudeMessage(value)
  if (text.trim()) {
    events.push({
      type: 'stdout',
      sessionId,
      payload: { text: text.endsWith('\n') ? text : `${text}\n` },
      timestamp: Date.now(),
    })
  }

  return events
}

function mapClaudeUserMessage(
  value: unknown,
  sessionId: string,
  state: ClaudeParserState,
): AgentEvent[] {
  return contentItems(value).flatMap((item): AgentEvent[] => {
    if (item.type !== 'tool_result') return []

    const toolUseId = typeof item.tool_use_id === 'string' ? item.tool_use_id : undefined
    const output = textFromClaudeMessage(item.content)
    return [
      activityEvent(sessionId, {
        kind: 'tool-result',
        name: (toolUseId && state.toolNamesById.get(toolUseId)) || 'tool',
        output: output.trim() ? output : undefined,
        status: item.is_error === true ? 'error' : 'done',
      }),
    ]
  })
}

function textFromClaudeMessage(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''

  if (Array.isArray(value)) {
    return value.map(textFromClaudeMessage).join('')
  }

  const record = value as Record<string, unknown>
  const content = record.content

  if (typeof record.text === 'string') return record.text
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(textFromClaudeMessage).join('')

  return ''
}

function contentItems(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.filter(isRecord)

  const content = (value as Record<string, unknown>).content
  if (!Array.isArray(content)) return []

  return content.filter(isRecord)
}

function mapClaudeStreamEvent(
  data: Record<string, unknown>,
  sessionId: string,
): AgentEvent[] {
  const event = objectPayload(data.event)
  const delta = objectPayload(event.delta)

  if (event.type === 'message_start') {
    return [
      activityEvent(sessionId, {
        kind: 'step',
        title: 'Claude response started',
        status: 'running',
      }),
    ]
  }

  const contentBlock = objectPayload(event.content_block)
  if (event.type === 'content_block_start' && contentBlock.type === 'thinking') {
    return [
      activityEvent(sessionId, {
        kind: 'step',
        title: 'Claude is planning',
        status: 'running',
      }),
    ]
  }

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

function activityEvent(sessionId: string, payload: AgentActivity): AgentEvent {
  return {
    type: 'activity',
    sessionId,
    payload,
    timestamp: Date.now(),
  }
}

function emitActivity(
  emitEvent: (event: AgentEvent) => void,
  sessionId: string,
  payload: AgentActivity,
): void {
  emitEvent(activityEvent(sessionId, payload))
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

function normalizeClaudeModelId(model: string): string {
  return CLAUDE_MODEL_ALIASES[model] ?? model
}

function visibleClaudeStderr(text: string): string {
  return text
    .split(/(?<=\n)/)
    .filter((line) => !isClaudeSessionEndHookWarning(line))
    .join('')
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
