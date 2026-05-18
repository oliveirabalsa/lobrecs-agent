import type { EventEmitter } from 'node:events'
import type { AgentEvent, AgentModel, AgentId } from '../../shared/types'
import type { ImageAttachment } from '../../shared/types'

export interface AgentSession {
  sessionId: string
  events: EventEmitter
  approve(): void
  reject(): void
  cancel(): void
}

export interface AgentDispatchParams {
  sessionId: string
  prompt: string
  repoPath: string
  model: string
  context?: string
  imageAttachments?: ImageAttachment[]
}

export interface AgentAdapter {
  id: AgentId
  name: string
  isInstalled(): Promise<boolean>
  listModels?(): Promise<AgentModel[]>
  dispatch(params: AgentDispatchParams): Promise<AgentSession>
}

export type AgentEventEmitter = EventEmitter<{
  event: [AgentEvent]
}>
