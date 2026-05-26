import type { EventEmitter } from 'node:events'
import type {
  AgentAccountInfo,
  AgentEvent,
  AgentModel,
  AgentId,
  AgentRuntimeSettings,
} from '../../shared/types'
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
  modelFallbacks?: string[]
  context?: string
  imageAttachments?: ImageAttachment[]
  runtimeSettings?: AgentRuntimeSettings
}

export interface AgentAdapter {
  id: AgentId
  name: string
  isInstalled(): Promise<boolean>
  listModels?(): Promise<AgentModel[]>
  getAccountInfo?(): Promise<AgentAccountInfo>
  dispatch(params: AgentDispatchParams): Promise<AgentSession>
}

export type AgentEventEmitter = EventEmitter<{
  event: [AgentEvent]
}>
