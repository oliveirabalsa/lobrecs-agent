import type { IpcRendererEvent } from 'electron'
import type {
  AgentDispatchParams,
  AgentDispatchResult,
  AgentDelegateTaskParams,
  AgentDelegateTaskResult,
  AgentModelRecoveryDecisionPayload,
  AgentPlanDecisionPayload,
  AgentPlanReviewDecisionPayload,
  EnqueueParams,
  QueuedMessage,
  QueueStatusEvent,
  SteerParams,
  SwarmStepApprovalDecisionPayload,
} from '../../shared/contracts/agents'
import type { AgentProfileListResult } from '../../shared/contracts/agentProfiles'
import {
  validateAgentDispatchParams,
  validateEnqueueParams,
  validateSteerParams,
} from '../../shared/contracts/agents'
import { assertPlainId } from '../../shared/contracts/validation'
import type { IpcInvoker, IpcSubscriber } from './ipc'

export interface AgentApi {
  dispatch(params: AgentDispatchParams): Promise<AgentDispatchResult>
  listProfiles(projectId: string): Promise<AgentProfileListResult>
  delegateTask(params: AgentDelegateTaskParams): Promise<AgentDelegateTaskResult>
  approve(sessionId: string): Promise<void>
  reject(sessionId: string): Promise<void>
  cancel(sessionId: string): Promise<void>
  killAll(): Promise<void>
  /** Resolves a pending `plan-prompt` round-trip from the main process. */
  planDecision(payload: AgentPlanDecisionPayload): Promise<void>
  /**
   * Approves or rejects a plan produced by a plan-mode session. Approving
   * dispatches the gated execution session and resolves with its identifiers;
   * rejecting resolves with `null`.
   */
  planReviewDecision(
    payload: AgentPlanReviewDecisionPayload,
  ): Promise<AgentDispatchResult | null>
  /**
   * Continues a session that paused after a provider/model limit with a
   * selected replacement model, or dismisses the recovery prompt.
   */
  modelRecoveryDecision(
    payload: AgentModelRecoveryDecisionPayload,
  ): Promise<AgentDispatchResult | null>
  /**
   * Resolves a pending `swarm-step-approval` round-trip. `continue` releases
   * the next sequential agent (optionally with edited promptSuffix/model);
   * `cancel` stops the swarm at this step.
   */
  stepApprovalDecision(
    payload: SwarmStepApprovalDecisionPayload,
  ): Promise<boolean>
  /** Adds a message to a thread's pending queue. Returns the queued entry. */
  enqueue(params: EnqueueParams): Promise<QueuedMessage>
  /** Returns the current queue snapshot for a thread. */
  getQueue(threadId: string): Promise<QueuedMessage[]>
  /** Removes a single queued message from a thread's queue. */
  dequeueItem(threadId: string, messageId: string): Promise<void>
  /** Clears every queued message for a thread. */
  clearQueue(threadId: string): Promise<void>
  /** Cancels the active session and immediately dispatches a new prompt on the same thread. */
  steer(params: SteerParams): Promise<AgentDispatchResult>
  /**
   * Subscribe to `queue:updated` broadcasts. The handler fires whenever the
   * pending queue for any thread changes. Returns an unsubscribe function.
   */
  onQueueUpdated(callback: (event: QueueStatusEvent) => void): () => void
}

export function createAgentApi(ipcRenderer: IpcInvoker & IpcSubscriber): AgentApi {
  return {
    dispatch: (params) => ipcRenderer.invoke('agent:dispatch', validateAgentDispatchParams(params)),
    listProfiles: (projectId) =>
      ipcRenderer.invoke('agent:list-profiles', assertPlainId(projectId, 'Project id')),
    delegateTask: (params) => ipcRenderer.invoke('agent:delegate-task', params),
    approve: (sessionId) => ipcRenderer.invoke('agent:approve', assertPlainId(sessionId, 'Session id')),
    reject: (sessionId) => ipcRenderer.invoke('agent:reject', assertPlainId(sessionId, 'Session id')),
    cancel: (sessionId) => ipcRenderer.invoke('agent:cancel', assertPlainId(sessionId, 'Session id')),
    killAll: () => ipcRenderer.invoke('agent:kill-all'),
    planDecision: (payload) => ipcRenderer.invoke('agent:plan-decision', payload),
    planReviewDecision: (payload) =>
      ipcRenderer.invoke('agent:plan-review-decision', payload),
    modelRecoveryDecision: (payload) =>
      ipcRenderer.invoke('agent:model-recovery-decision', payload),
    stepApprovalDecision: (payload) =>
      ipcRenderer.invoke('swarm:step-approval-decision', payload),
    enqueue: (params) => ipcRenderer.invoke('agent:enqueue', validateEnqueueParams(params)),
    getQueue: (threadId) => ipcRenderer.invoke('agent:queue-status', assertPlainId(threadId, 'Thread id')),
    dequeueItem: (threadId, messageId) =>
      ipcRenderer.invoke('agent:dequeue-item', {
        threadId: assertPlainId(threadId, 'Thread id'),
        messageId: assertPlainId(messageId, 'Message id'),
      }),
    clearQueue: (threadId) => ipcRenderer.invoke('agent:clear-queue', assertPlainId(threadId, 'Thread id')),
    steer: (params) => ipcRenderer.invoke('agent:steer', validateSteerParams(params)),
    onQueueUpdated: (callback) => {
      const handler = (_event: IpcRendererEvent, payload: QueueStatusEvent) => callback(payload)
      ipcRenderer.on('queue:updated', handler)
      return () => ipcRenderer.removeListener('queue:updated', handler)
    },
  }
}
