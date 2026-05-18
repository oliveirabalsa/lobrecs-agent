import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import type { AgentPlanDecisionPayload } from '../../shared/contracts/agents'

export interface PlanPromptOption {
  id: string
  label: string
}

export interface AskPlanPromptOptions {
  /**
   * Optional window override. When omitted the helper broadcasts the prompt
   * to every open BrowserWindow so the renderer it lands in shows the modal.
   */
  window?: BrowserWindow
  /**
   * Session id used to scope the event to a particular workspace stream.
   * For round-trips where no session exists yet (e.g. swarm spec
   * confirmation) callers may pass any synthetic id; the renderer just uses
   * it to route the event.
   */
  sessionId: string
  title: string
  options: PlanPromptOption[]
  allowFreeText?: boolean
  /** Default 5 minutes. */
  timeoutMs?: number
}

export interface PlanDecision {
  optionId: string
  freeText?: string
}

export type PlanPromptOutcome = PlanDecision | 'timeout' | 'cancelled'

interface PendingPrompt {
  resolve: (outcome: PlanPromptOutcome) => void
  timeoutHandle: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

const pending = new Map<string, PendingPrompt>()

function settle(promptId: string, outcome: PlanPromptOutcome): boolean {
  const entry = pending.get(promptId)
  if (!entry) return false
  clearTimeout(entry.timeoutHandle)
  pending.delete(promptId)
  entry.resolve(outcome)
  return true
}

function broadcastPlanPrompt(
  win: BrowserWindow | undefined,
  sessionId: string,
  payload: {
    promptId: string
    title: string
    options: PlanPromptOption[]
    allowFreeText: boolean
  },
): void {
  const event = {
    type: 'activity' as const,
    sessionId,
    payload: {
      kind: 'plan-prompt' as const,
      ...payload,
    },
    timestamp: Date.now(),
  }
  const channel = `session:${sessionId}`

  const recipients = win ? [win] : BrowserWindow.getAllWindows()
  for (const target of recipients) {
    target.webContents.send(channel, event)
  }
}

/**
 * Emits a `plan-prompt` activity to the renderer and waits for the matching
 * `agent:plan-decision` IPC. Returns the decision, or `'timeout'` /
 * `'cancelled'` when the prompt resolves without a user choice.
 */
export function askPlanPrompt(opts: AskPlanPromptOptions): Promise<PlanPromptOutcome> {
  const promptId = randomUUID()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise<PlanPromptOutcome>((resolve) => {
    const timeoutHandle = setTimeout(() => {
      settle(promptId, 'timeout')
    }, timeoutMs)

    pending.set(promptId, { resolve, timeoutHandle })

    try {
      broadcastPlanPrompt(opts.window, opts.sessionId, {
        promptId,
        title: opts.title,
        options: opts.options,
        allowFreeText: opts.allowFreeText ?? false,
      })
    } catch (error) {
      settle(promptId, 'cancelled')
      throw error
    }
  })
}

/**
 * Resolves a pending plan prompt. Invoked from the renderer via the
 * `agent:plan-decision` IPC handler. Returns `true` when a matching prompt
 * was found; `false` when the prompt already settled (timeout/cancellation).
 */
export function submitPlanDecision(payload: AgentPlanDecisionPayload): boolean {
  if (!payload?.promptId) return false
  return settle(payload.promptId, {
    optionId: payload.optionId,
    freeText: payload.freeText,
  })
}

/**
 * Cancels every pending prompt — used on session cancellation and during
 * shutdown so callers don't leak hung promises.
 */
export function cancelAllPlanPrompts(): void {
  const ids = [...pending.keys()]
  for (const id of ids) settle(id, 'cancelled')
}

/** Test helper. */
export function hasPendingPlanPrompts(): boolean {
  return pending.size > 0
}
