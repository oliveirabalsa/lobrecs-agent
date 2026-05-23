import type { AgentActivity } from '../../../../../shared/types'

export const PLAN_MODE_RESET_EVENT = 'agentforge:composer-plan-mode-reset'

/**
 * Plan mode is a one-shot control. If a dispatch used it, reset the toggle so
 * follow-up prompts run as normal execution by default.
 */
export function shouldResetPlanModeAfterDispatch(planMode: boolean): boolean {
  return planMode
}

/**
 * Answering an agent question is a follow-up dispatch on the same thread. If
 * the interrupted session was a plan-mode planning turn, the answer must keep
 * the planning gate active instead of turning into an execution run.
 */
export function shouldContinuePlanModeAfterQuestionAnswer(
  planMode: boolean | null | undefined,
): boolean {
  return planMode === true
}

/**
 * Returns the most recent plan-review marker id in a session activity list.
 * When present, the planning phase is complete and the composer should drop
 * any sticky plan-mode toggle.
 */
export function latestPlanReviewId(
  activities: readonly AgentActivity[],
): string | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]
    if (activity.kind === 'plan-review') return activity.reviewId
  }
  return null
}

export function emitPlanModeReset(target: EventTarget | null | undefined): void {
  if (!target) return
  target.dispatchEvent(new Event(PLAN_MODE_RESET_EVENT))
}
