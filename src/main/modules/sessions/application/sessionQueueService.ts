import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type {
  AgentApprovalMode,
  AgentId,
  AgentRuntimeSettings,
  QueuedMessage,
  QueueStatusEvent,
} from '../../../../shared/types'
import type { DispatchSessionParams, DispatchSessionResult } from '../../../session/SessionManager'
import type { ActiveSession, PendingQueuedMessage } from './sessionWorkflowTypes'
import { publicQueuedMessage, publicQueuedMessages } from './sessionWorkflowTypes'
import { errorMessage } from './sessionWorkflowUtils'

const require = createRequire(import.meta.url)

export type SessionQueueServiceOptions = {
  activeSessions: Map<string, ActiveSession>
  pendingQueues: Map<string, PendingQueuedMessage[]>
  dispatch(params: DispatchSessionParams): Promise<DispatchSessionResult>
}

export class SessionQueueService {
  constructor(private readonly options: SessionQueueServiceOptions) {}

  enqueueMessage(
    params: {
      prompt: string
      agentId: AgentId
      model: string
      profileId?: QueuedMessage['profileId']
      approvalMode?: AgentApprovalMode
      thinking?: QueuedMessage['thinking']
      runtimeSettings?: AgentRuntimeSettings
    },
    threadId: string,
  ): QueuedMessage {
    const message: PendingQueuedMessage = {
      id: randomUUID(),
      prompt: params.prompt,
      agentId: params.agentId,
      model: params.model,
      profileId: params.profileId,
      approvalMode: params.approvalMode,
      thinking: params.thinking,
      runtimeSettings: params.runtimeSettings,
      createdAt: Date.now(),
    }

    const queue = this.options.pendingQueues.get(threadId) ?? []
    const updated = [...queue, message]
    this.options.pendingQueues.set(threadId, updated)
    broadcastQueueUpdated(threadId, publicQueuedMessages(updated))
    return publicQueuedMessage(message)
  }

  getQueue(threadId: string): QueuedMessage[] {
    return publicQueuedMessages(this.options.pendingQueues.get(threadId) ?? [])
  }

  removeQueueItem(threadId: string, messageId: string): void {
    const queue = this.options.pendingQueues.get(threadId)
    if (!queue) return

    const updated = queue.filter((message) => message.id !== messageId)
    if (updated.length === queue.length) return

    if (updated.length === 0) {
      this.options.pendingQueues.delete(threadId)
    } else {
      this.options.pendingQueues.set(threadId, updated)
    }
    broadcastQueueUpdated(threadId, publicQueuedMessages(updated))
  }

  clearQueue(threadId: string): void {
    if (!this.options.pendingQueues.has(threadId)) return

    this.options.pendingQueues.delete(threadId)
    broadcastQueueUpdated(threadId, [])
  }

  isThreadBusy(threadId: string): boolean {
    for (const active of this.options.activeSessions.values()) {
      if (active.threadId === threadId) return true
    }
    return false
  }

  async dispatchNextQueued(
    threadId: string,
    fallback: { projectId: string; repoPath: string },
  ): Promise<void> {
    const queue = this.options.pendingQueues.get(threadId)
    if (!queue?.length) return

    if (this.isThreadBusy(threadId)) return

    const [next, ...rest] = queue
    if (rest.length === 0) {
      this.options.pendingQueues.delete(threadId)
    } else {
      this.options.pendingQueues.set(threadId, rest)
    }
    broadcastQueueUpdated(threadId, publicQueuedMessages(rest))

    try {
      await this.options.dispatch({
        projectId: fallback.projectId,
        prompt: next.prompt,
        agentId: next.agentId,
        model: next.model,
        repoPath: fallback.repoPath,
        threadId,
        runtimeSettings: next.runtimeSettings,
      })
    } catch (error) {
      console.error(
        `[session] queued dispatch failed for thread ${threadId}:`,
        errorMessage(error),
      )
    }
  }
}

function broadcastQueueUpdated(threadId: string, pending: QueuedMessage[]): void {
  try {
    const electron = require('electron') as {
      BrowserWindow?: {
        getAllWindows(): Array<{
          webContents: { send(channel: string, payload: QueueStatusEvent): void }
        }>
      }
    }

    const payload: QueueStatusEvent = { threadId, pending }
    for (const win of electron.BrowserWindow?.getAllWindows() ?? []) {
      win.webContents.send('queue:updated', payload)
    }
  } catch {
    // Unit tests and non-Electron contexts: silently noop.
  }
}
