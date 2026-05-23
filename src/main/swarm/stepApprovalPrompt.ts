import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { sessionsStore } from '../store'
import type {
  AgentActivity,
  SwarmStepApprovalDecisionPayload,
} from '../../shared/types'

export interface AskStepApprovalOptions {
  /** Session whose event stream the approval activity is appended to. */
  sessionId: string
  completedRole: string
  nextRole: string
  nextAgentId: string
  nextModel: string
  nextPromptSuffix?: string
  /** Defaults to 30 minutes. */
  timeoutMs?: number
}

export interface StepApprovalContinue {
  outcome: 'continue'
  editedPromptSuffix?: string
  modelOverride?: string
}

export type StepApprovalResult =
  | StepApprovalContinue
  | { outcome: 'cancelled' }
  | { outcome: 'timeout' }

interface PendingPrompt {
  resolve: (result: StepApprovalResult) => void
  timeoutHandle: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

const pending = new Map<string, PendingPrompt>()

function settle(approvalId: string, result: StepApprovalResult): boolean {
  const entry = pending.get(approvalId)
  if (!entry) return false
  clearTimeout(entry.timeoutHandle)
  pending.delete(approvalId)
  entry.resolve(result)
  return true
}

function broadcastApproval(sessionId: string, activity: Extract<AgentActivity, { kind: 'swarm-step-approval' }>): void {
  const timestamp = Date.now()
  sessionsStore.addEvent({
    type: 'activity',
    sessionId,
    payload: activity,
    timestamp,
  })

  const channel = `session:${sessionId}`
  const event = { type: 'activity' as const, sessionId, payload: activity, timestamp }
  for (const target of BrowserWindow.getAllWindows()) {
    target.webContents.send(channel, event)
  }
}

/**
 * Emits a `swarm-step-approval` activity to the renderer and waits for the
 * matching `swarm:step-approval-decision` IPC. Resolves with the user's
 * decision (continue or cancel), or `'timeout'` after the default window.
 */
export function askStepApproval(opts: AskStepApprovalOptions): Promise<StepApprovalResult> {
  const approvalId = randomUUID()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise<StepApprovalResult>((resolve) => {
    const timeoutHandle = setTimeout(() => {
      settle(approvalId, { outcome: 'timeout' })
    }, timeoutMs)

    pending.set(approvalId, { resolve, timeoutHandle })

    try {
      broadcastApproval(opts.sessionId, {
        kind: 'swarm-step-approval',
        approvalId,
        completedRole: opts.completedRole,
        nextRole: opts.nextRole,
        nextAgentId: opts.nextAgentId,
        nextModel: opts.nextModel,
        ...(opts.nextPromptSuffix ? { nextPromptSuffix: opts.nextPromptSuffix } : {}),
      })
    } catch (error) {
      settle(approvalId, { outcome: 'cancelled' })
      throw error
    }
  })
}

/**
 * Resolves a pending step-approval prompt. Invoked from the renderer via the
 * `swarm:step-approval-decision` IPC handler. Returns `true` when a matching
 * prompt was found; `false` when the prompt already settled.
 */
export function submitStepApprovalDecision(
  payload: SwarmStepApprovalDecisionPayload,
): boolean {
  if (!payload?.approvalId) return false
  if (payload.decision === 'cancel') {
    return settle(payload.approvalId, { outcome: 'cancelled' })
  }

  const editedPromptSuffix = payload.editedPromptSuffix?.trim()
  const modelOverride = payload.modelOverride?.trim()
  return settle(payload.approvalId, {
    outcome: 'continue',
    ...(editedPromptSuffix ? { editedPromptSuffix } : {}),
    ...(modelOverride ? { modelOverride } : {}),
  })
}

/** Cancel every pending step approval — used on shutdown / swarm cancel. */
export function cancelAllStepApprovals(): void {
  const ids = [...pending.keys()]
  for (const id of ids) settle(id, { outcome: 'cancelled' })
}

/** Test helper. */
export function hasPendingStepApprovals(): boolean {
  return pending.size > 0
}
