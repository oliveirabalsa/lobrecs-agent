/**
 * Plan-mode prompt construction.
 *
 * Plan mode splits an agent task into two phases:
 *
 *  1. Planning — the agent receives the user's task wrapped by
 *     `buildPlanModePrompt` and is told to produce a structured plan WITHOUT
 *     touching the repository, then stop.
 *  2. Execution — only after the user approves the plan, a second session is
 *     dispatched on the same thread with `buildPlanExecutionPrompt`. Because
 *     thread history is replayed into the adapter context (see
 *     `SessionManager.buildAdapterContext`), the agent still sees the plan it
 *     proposed in phase 1.
 *
 * The wrapper is applied to the adapter prompt only — `sessionsStore` keeps the
 * original task text so the UI bubble and thread transcript stay clean.
 */

/** Header used so the agent (and a curious reader of logs) can spot the mode. */
export const PLAN_MODE_HEADER = '[Plan Mode]'

/**
 * Wraps a user task with planning instructions. The agent should respond with
 * a plan and make no changes.
 */
export function buildPlanModePrompt(task: string): string {
  return [
    `${PLAN_MODE_HEADER} Before doing any work, produce a clear, structured`,
    'implementation plan for the task below. Lay out the concrete steps in',
    'order, the files you expect to create or modify, and any risks or open',
    'questions worth flagging.',
    '',
    'Do NOT edit files, run commands, or make any changes yet — only present',
    'the plan as your response, then stop and wait for approval.',
    '',
    'Task:',
    task.trim(),
  ].join('\n')
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
