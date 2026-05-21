/**
 * Plan-mode prompt construction.
 *
 * Plan mode splits an agent task into two phases:
 *
 *  1. Planning — the agent receives the user's task as the task, with
 *     `buildPlanModeContext` appended to adapter context. Keeping the actual
 *     task in the prompt prevents the agent from planning how to create a
 *     plan.
 *  2. Execution — only after the user approves the plan, a second session is
 *     dispatched on the same thread with `buildPlanExecutionPrompt`. Because
 *     thread history is replayed into the adapter context (see
 *     `SessionManager.buildAdapterContext`), the agent still sees the plan it
 *     proposed in phase 1.
 *
 * The plan-mode instructions are applied to the adapter context only —
 * `sessionsStore` keeps the original task text so the UI bubble and thread
 * transcript stay clean.
 */

/** Header used so the agent (and a curious reader of logs) can spot the mode. */
export const PLAN_MODE_HEADER = '[Plan Mode]'

const PLAN_MODE_CONTEXT = [
  `${PLAN_MODE_HEADER} Planning gate`,
  'The user prompt is the implementation request. Treat that prompt as the',
  'actual work request, even if the UI says the user asked for a plan.',
  '',
  'Your response must be the implementation plan itself. Start directly with',
  'the concrete implementation steps for the requested change, then list the',
  'files you expect to create or modify, verification you will run, and any',
  'real risks or open questions worth flagging.',
  '',
  'Do not create a plan for drafting another plan, asking for approval,',
  'collecting approval, or planning the planning process. Do not answer with',
  '"I will create a plan", "first I will understand the request", or other',
  'meta-planning steps unless they are concrete implementation work for the',
  'user prompt. This response is the plan.',
  '',
  'Do NOT edit files, run commands, or make any repository changes in this',
  'phase. Present the plan, then stop and wait for approval.',
].join('\n')

/**
 * Adds plan-mode instructions to adapter context while leaving the adapter
 * prompt as the user's actual task.
 */
export function buildPlanModeContext(
  context: string | null | undefined,
): string {
  const trimmedContext = context?.trim()
  if (!trimmedContext) return PLAN_MODE_CONTEXT

  return `${trimmedContext}\n\n${PLAN_MODE_CONTEXT}`
}

/**
 * Prompt for the execution session dispatched once the user approves a plan.
 * The plan itself arrives via replayed thread history, so this only needs to
 * release the agent to act on it.
 */
export function buildPlanExecutionPrompt(): string {
  return [
    `${PLAN_MODE_HEADER} Your plan has been approved.`,
    'Execute it now in full: make the file changes and run the steps you',
    'described in the plan above. Follow the plan as written; if you must',
    'deviate, briefly explain why.',
  ].join('\n')
}
