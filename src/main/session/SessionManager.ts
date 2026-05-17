import type { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import type { AgentEvent, AgentId, SessionStatus } from '../../shared/types'
import { worktreeManager } from '../git/WorktreeManager'
import { sessionsStore } from '../store'
import { deriveActivityEvents } from './activity'
import { buildDiffProposals } from './worktreeDiff'

const require = createRequire(import.meta.url)

export type AgentSession = {
  sessionId: string
  events: EventEmitter
  approve(): void
  reject(): void
  cancel(): void
}

export type AgentAdapter = {
  id: AgentId
  name?: string
  dispatch(params: {
    sessionId: string
    prompt: string
    repoPath: string
    model: string
    context?: string | null
  }): Promise<AgentSession>
}

export type DispatchSessionParams = {
  projectId: string
  prompt: string
  agentId: AgentId
  model: string
  repoPath: string
  context?: string | null
  isolate?: boolean
}

export type EventBroadcaster = (event: AgentEvent) => void
export type CostEstimator = (model: string, tokensIn: number, tokensOut: number) => number
export type AdapterResolver = (agentId: AgentId) => AgentAdapter | undefined

type ActiveSession = Pick<AgentSession, 'approve' | 'reject' | 'cancel'> & {
  repoPath: string
  worktreePath: string | null
}

export type SessionManagerOptions = {
  adapters?: Iterable<AgentAdapter>
  adapterResolver?: AdapterResolver
  broadcast?: EventBroadcaster
  estimateCost?: CostEstimator
  worktreeIsolation?: boolean
}

export class SessionManager {
  private readonly adapters = new Map<AgentId, AgentAdapter>()
  private readonly activeSessions = new Map<string, ActiveSession>()
  private readonly adapterResolver?: AdapterResolver
  private readonly broadcastEvent: EventBroadcaster
  private readonly worktreeIsolation: boolean
  private estimateCost: CostEstimator

  constructor(options: SessionManagerOptions = {}) {
    this.adapterResolver = options.adapterResolver
    this.broadcastEvent = options.broadcast ?? broadcastToRenderer
    this.worktreeIsolation = options.worktreeIsolation ?? true
    this.estimateCost = options.estimateCost ?? (() => 0)

    for (const adapter of options.adapters ?? []) {
      this.registerAdapter(adapter)
    }
  }

  registerAdapter(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id, adapter)
  }

  setCostEstimator(estimateCost: CostEstimator): void {
    this.estimateCost = estimateCost
  }

  async dispatch(params: DispatchSessionParams): Promise<string> {
    const session = sessionsStore.create({
      projectId: params.projectId,
      agentId: params.agentId,
      model: params.model,
      prompt: params.prompt,
      status: 'running',
    })

    const adapter = this.resolveAdapter(params.agentId)
    if (!adapter) {
      const error = new Error(`Adapter not found: ${params.agentId}`)
      this.failSession(session.id, error)
      throw error
    }

    try {
      const shouldIsolate = params.isolate ?? this.worktreeIsolation
      const worktreePath = shouldIsolate
        ? await worktreeManager.create(session.id, params.repoPath)
        : null

      if (worktreePath) {
        this.emitSyntheticEvent(session.id, {
          kind: 'step',
          title: 'Created isolated worktree',
          detail: worktreePath,
          status: 'done',
        })
      }

      const agentSession = await adapter.dispatch({
        sessionId: session.id,
        prompt: params.prompt,
        repoPath: worktreePath ?? params.repoPath,
        model: params.model,
        context: params.context,
      })

      this.activeSessions.set(session.id, {
        approve: () => agentSession.approve(),
        reject: () => agentSession.reject(),
        cancel: () => agentSession.cancel(),
        repoPath: params.repoPath,
        worktreePath,
      })

      agentSession.events.on('event', (event: AgentEvent) => {
        this.handleAgentEvent({ ...event, sessionId: session.id })
      })

      return session.id
    } catch (error) {
      await worktreeManager.remove(session.id, params.repoPath)
      this.failSession(session.id, error)
      throw error
    }
  }

  approve(sessionId: string): void {
    this.activeSessions.get(sessionId)?.approve()
    const session = sessionsStore.get(sessionId)
    if (session?.status === 'awaiting-approval') {
      sessionsStore.updateStatus(sessionId, 'running')
    }
  }

  reject(sessionId: string): void {
    this.activeSessions.get(sessionId)?.reject()
    const session = sessionsStore.get(sessionId)
    if (session?.status === 'awaiting-approval') {
      sessionsStore.updateStatus(sessionId, 'running')
    }
  }

  cancel(sessionId: string): void {
    this.activeSessions.get(sessionId)?.cancel()
    const active = this.activeSessions.get(sessionId)
    this.activeSessions.delete(sessionId)
    void worktreeManager.remove(sessionId, active?.repoPath)

    if (sessionsStore.get(sessionId)) {
      sessionsStore.updateStatus(sessionId, 'cancelled')
    }
  }

  cancelAll(): void {
    for (const sessionId of this.activeSessions.keys()) {
      this.cancel(sessionId)
    }
  }

  isActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId)
  }

  private resolveAdapter(agentId: AgentId): AgentAdapter | undefined {
    return this.adapterResolver?.(agentId) ?? this.adapters.get(agentId)
  }

  private handleAgentEvent(event: AgentEvent): void {
    sessionsStore.addEvent(event)
    this.broadcastEvent(event)

    for (const activityEvent of deriveActivityEvents(event)) {
      sessionsStore.addEvent(activityEvent)
      this.broadcastEvent(activityEvent)
    }

    if (event.type === 'approval-request') {
      sessionsStore.updateStatus(event.sessionId, 'awaiting-approval')
      return
    }

    if (event.type === 'session-complete') {
      this.applyUsage(event)
      sessionsStore.updateStatus(event.sessionId, completionStatus(event))
      void this.emitWorktreeDiff(event.sessionId)
      this.activeSessions.delete(event.sessionId)
      return
    }

    if (event.type === 'error') {
      sessionsStore.updateStatus(event.sessionId, 'error')
      void this.removeWorktree(event.sessionId)
      this.activeSessions.delete(event.sessionId)
    }
  }

  private emitSyntheticEvent(sessionId: string, payload: AgentEvent['payload']): void {
    this.handleAgentEvent({
      type: 'activity',
      sessionId,
      payload,
      timestamp: Date.now(),
    })
  }

  private async emitWorktreeDiff(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    if (!active?.worktreePath) return

    try {
      const proposals = await buildDiffProposals(active.worktreePath, active.repoPath)
      if (proposals.length > 0) {
        this.handleAgentEvent({
          type: 'diff',
          sessionId,
          payload: proposals,
          timestamp: Date.now(),
        })
      }
    } catch (error) {
      this.handleAgentEvent({
        type: 'error',
        sessionId,
        payload: { message: errorMessage(error) },
        timestamp: Date.now(),
      })
    } finally {
      await this.removeWorktree(sessionId)
    }
  }

  private async removeWorktree(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    await worktreeManager.remove(sessionId, active?.repoPath)
  }

  private applyUsage(event: AgentEvent): void {
    const usage = extractUsage(event.payload)
    if (!usage) return

    const session = sessionsStore.get(event.sessionId)
    if (!session) return

    const costUsd =
      usage.costUsd ?? this.estimateCost(session.model, usage.tokensIn, usage.tokensOut)

    sessionsStore.updateUsage(event.sessionId, usage.tokensIn, usage.tokensOut, costUsd)
  }

  private failSession(sessionId: string, error: unknown): void {
    const event: AgentEvent = {
      type: 'error',
      sessionId,
      payload: { message: errorMessage(error) },
      timestamp: Date.now(),
    }

    sessionsStore.addEvent(event)
    sessionsStore.updateStatus(sessionId, 'error')
    this.broadcastEvent(event)
    this.activeSessions.delete(sessionId)
  }
}

export const sessionManager = new SessionManager()

function completionStatus(event: AgentEvent): SessionStatus {
  const payload = objectPayload(event.payload)
  const exitCode = readNumber(payload, 'exitCode')

  return exitCode !== undefined && exitCode !== 0 ? 'error' : 'done'
}

function broadcastToRenderer(event: AgentEvent): void {
  try {
    const electron = require('electron') as {
      BrowserWindow?: {
        getAllWindows(): Array<{ webContents: { send(channel: string, payload: AgentEvent): void } }>
      }
    }

    for (const win of electron.BrowserWindow?.getAllWindows() ?? []) {
      win.webContents.send(`session:${event.sessionId}`, event)
    }
  } catch {
    // Unit tests and non-Electron contexts can provide an explicit broadcaster.
  }
}

function extractUsage(payload: unknown):
  | { tokensIn: number; tokensOut: number; costUsd?: number }
  | null {
  const payloadObject = objectPayload(payload)
  const usageObject = objectPayload(payloadObject.usage) ?? payloadObject

  const tokensIn =
    readNumber(usageObject, 'input_tokens') ??
    readNumber(usageObject, 'inputTokens') ??
    readNumber(usageObject, 'tokens_in') ??
    readNumber(usageObject, 'tokensIn') ??
    0
  const tokensOut =
    readNumber(usageObject, 'output_tokens') ??
    readNumber(usageObject, 'outputTokens') ??
    readNumber(usageObject, 'tokens_out') ??
    readNumber(usageObject, 'tokensOut') ??
    0
  const costUsd =
    readNumber(usageObject, 'cost_usd') ??
    readNumber(usageObject, 'costUsd') ??
    readNumber(payloadObject, 'cost_usd') ??
    readNumber(payloadObject, 'costUsd')

  if (tokensIn === 0 && tokensOut === 0 && costUsd === undefined) {
    return null
  }

  return { tokensIn, tokensOut, costUsd }
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readNumber(object: Record<string, unknown>, key: string): number | undefined {
  const value = object[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
