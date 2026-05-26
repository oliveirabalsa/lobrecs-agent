import type {
  AgentActivity,
  AgentId,
  AgentRuntimeSettings,
  ImageAttachment,
  QueuedMessage,
  SessionStatus,
  SpawnedAgentSession,
} from '../../../../shared/types'
import type { LocalChangeBaseline } from '../../../session/localDiff'

export const TERMINAL_SESSION_STATUSES = new Set<SessionStatus>([
  'done',
  'error',
  'cancelled',
])

export const LIVE_DIFF_DEBOUNCE_MS = 120

export type ActiveSession = {
  approve(): void
  reject(): void
  cancel(): void
  repoPath: string
  threadId: string
  worktreePath: string | null
  persistentWorktree: boolean
  localBaseline: LocalChangeBaseline | null
  localTouchedFiles: Set<string>
  sharedLocalRepo: boolean
  liveDiffTimer?: ReturnType<typeof setTimeout>
  liveDiffSignature?: string
  lastAgentEventAt: number
  lastIdleHeartbeatAt: number
  idleHeartbeatTimer?: ReturnType<typeof setTimeout>
  qualityAttempt: number
  planMode: boolean
  isolate: boolean
  runtimeSettings?: AgentRuntimeSettings
  baseContext?: string | null
  contextQuery?: string
  prompt: string
  agentId: AgentId
  modelFallbacks: string[]
  imageAttachments?: ImageAttachment[]
  adapterContext?: string | null
  modelRecoveryMode: 'prompt' | 'auto'
  providerLimitReason?: string
}

export type PendingQueuedMessage = QueuedMessage & {
  runtimeSettings?: AgentRuntimeSettings
}

export type PlanReviewRecord = {
  reviewId: string
  planningSessionId: string
  projectId: string
  threadId: string
  repoPath: string
  agentId: AgentId
  model: string
  isolate: boolean
  runtimeSettings?: AgentRuntimeSettings
  taskPrompt: string
  baseContext?: string | null
}

export type ModelRecoveryRecord = {
  recoveryId: string
  sourceSessionId: string
  projectId: string
  threadId: string
  repoPath: string
  prompt: string
  agentId: AgentId
  model: string
  isolate: boolean
  runtimeSettings?: AgentRuntimeSettings
  baseContext?: string | null
  contextQuery?: string
  imageAttachments?: ImageAttachment[]
  planMode: boolean
  requiresImageSupport: boolean
  reason: string
}

export type DelegatedTaskRecord = {
  delegationId: string
  parentSessionId: string
  childSessionId: string
  childThreadId: string
  goal: string
  agentId: AgentId
  model: string
  lastOutput?: string
  summary?: string
  error?: string
  status?: 'running' | 'done' | 'error' | 'cancelled'
}

export function isUserQuestionActivity(payload: unknown): payload is Extract<
  AgentActivity,
  { kind: 'user-question' }
> {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { kind?: unknown }).kind === 'user-question'
  )
}

export function publicQueuedMessage(message: PendingQueuedMessage): QueuedMessage {
  const { runtimeSettings: _runtimeSettings, ...publicMessage } = message
  return publicMessage
}

export function publicQueuedMessages(messages: readonly PendingQueuedMessage[]): QueuedMessage[] {
  return messages.map(publicQueuedMessage)
}
