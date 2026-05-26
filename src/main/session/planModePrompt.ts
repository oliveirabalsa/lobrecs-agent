/**
 * Plan-mode prompt construction.
 *
 * Plan mode splits an agent task into two phases:
 *
 *  1. Planning — the agent receives the user's task as the task, with
 *     `buildPlanModeContext` appended to adapter context. Keeping the actual
 *     task in the prompt prevents the agent from planning how to create a
 *     plan. The planning agent may inspect the repository with read-only
 *     commands, but must not make code changes.
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
  'the concrete implementation plan for the requested change. The plan must',
  'be detailed enough that an implementation agent can execute it without',
  'creating another plan first.',
  '',
  'The app may have injected project instructions, a repository symbol map,',
  'retrieved snippets, current file structure, and thread history. Treat that',
  'context as starting evidence, not a substitute for live investigation.',
  'Before writing the plan, actively inspect the repository structure, search',
  'for owning files and APIs, read the relevant files, and run targeted',
  'read-only diagnostic commands when they improve the plan. Prefer fast',
  'commands such as `rg`, `rg --files`, `sed`, `git status --short`, or',
  'package-script discovery. Do not invent filenames, functions, IPC channels,',
  'UI components, or tests that are not supported by injected or live evidence.',
  'If evidence is incomplete after inspection, state the exact area the',
  'implementation phase must inspect next and why.',
  '',
  'Use this structure:',
  '1. Goal and expected behavior change.',
  '2. Current-state diagnosis from the available project context and thread',
  '   history. Name the likely owning files, functions, contracts, or UI',
  '   components when they are known.',
  '3. File-by-file implementation steps with concrete logic, state, IPC, data',
  '   flow, or UI changes to make.',
  '4. Focused tests and verification commands to run after implementation.',
  '5. Risks, edge cases, and any migration or follow-up notes.',
  '',
  'Keep every step actionable. Do not make the plan a generic discovery plan.',
  'If more inspection will be needed during implementation, name the exact area',
  'to inspect and why, then continue with the expected code change.',
  '',
  'This phase is read-only and investigative. Do NOT edit files, write files,',
  'apply patches, run formatters, run code generation, install dependencies,',
  'change git state, or execute mutating commands. Do not produce patch hunks,',
  'code blocks, or implementation output. If the request needs code changes,',
  'describe them in the plan and stop there.',
  '',
  'If you have ANY clarifying question whose answer would change the plan',
  '(naming, scope, UX trade-offs, ambiguous requirements), you MUST call the',
  '`AskUserQuestion` tool to ask the user before producing the plan, then',
  'incorporate the answers into the plan. Do NOT inline questions as numbered',
  'bullets or an "Open questions" section in the plan markdown — the user',
  'cannot answer those inline. Only the `AskUserQuestion` tool produces an',
  'answerable prompt. If you have no question, skip the tool and write the plan.',
  '',
  'Do not create a plan for drafting another plan, asking for approval,',
  'collecting approval, or planning the planning process. Do not answer with',
  '"I will create a plan", "first I will understand the request", or other',
  'meta-planning steps unless they are concrete implementation work for the',
  'user prompt. Do not include "wait for approval" as an implementation step;',
  'the app handles approval after this response. This response is the plan.',
  '',
  'Do NOT edit files or make any repository changes in this phase. Present the',
  'plan, then stop and wait for approval.',
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
 * The base plan arrives via replayed thread history; optional edited plan text
 * and user suggestions can be appended at approval time.
 */
export function buildPlanExecutionPrompt(options?: {
  editedPlanText?: string
  suggestionText?: string
}): string {
  const editedPlanText = normalizePlanModeText(options?.editedPlanText)
  const suggestionText = normalizePlanModeText(options?.suggestionText)

  const lines = [
    `${PLAN_MODE_HEADER} Your plan has been approved.`,
    'Execute it now in full: make the file changes and run the steps you',
    'described in the plan above. Follow the plan as written; if you must',
    'deviate, briefly explain why.',
  ]

  if (editedPlanText) {
    lines.push(
      '',
      'Use this edited approved plan as the source of truth:',
      editedPlanText,
    )
  }

  if (suggestionText) {
    lines.push(
      '',
      'Additional user suggestions to apply while executing:',
      suggestionText,
    )
  }

  return lines.join('\n')
}

function normalizePlanModeText(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}
