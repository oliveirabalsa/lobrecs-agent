# Terminal-Driven Remediation Implementation Plan

## Direction

Prioritize Terminal-Driven Remediation before the cleanup ideas.

This is the strongest next product move for Lobrecs Agent because it turns a
real developer failure state into an immediate repair workflow. Legacy module
relocation and the complexity scorer refactor are still useful, but they are
enabling work. The visible user value is: a failed command appears in the
terminal, Lobrecs captures the useful context, and one click starts an agent run
against the same project/thread.

## Product Behavior

- Detect failed terminal commands, starting with commands that exit non-zero in
  the bottom shell terminal.
- Show a compact remediation affordance near the failed terminal session:
  `Fix with Agent`.
- Start a new agent session with:
  - the command that failed,
  - exit code and signal,
  - recent terminal output around the failure,
  - project repo path,
  - current thread id when available,
  - a short instruction to diagnose, fix, and run focused verification.
- Keep the user in the current workspace after dispatching the repair session.
- Reuse existing agent routing unless the user manually selected a model.

## Scope

### In Scope

- Bottom terminal failure detection for shell sessions opened from the workspace
  footer.
- A renderer-only command-output ring buffer, capped by size and line count.
- A typed remediation context contract shared across renderer and main process.
- A narrow preload/API entry point or reuse of `agent.dispatch` with a generated
  prompt.
- Focused tests for failure-context parsing, prompt generation, and UI state.

### Out of Scope

- Local LLM routing scorer changes.
- Moving `src/main/swarm`, `src/main/agents`, or `src/main/router` as part of
  this feature.
- Persisting raw terminal logs in SQLite.
- Detecting every interactive shell command boundary perfectly on day one.
- Automatically fixing without an explicit user click.

## Architecture Fit

Current relevant files:

- `src/renderer/modules/workspace/components/BottomTerminalPanel.tsx` owns the
  bottom shell/editor terminal UI and receives terminal data/exit events.
- `src/main/modules/system/application/cliEditorTerminal.ts` owns PTY lifecycle
  in the main process.
- `src/shared/contracts/system.ts` owns the existing terminal event contracts.
- `src/shared/contracts/agents.ts` owns `AgentDispatchParams`.
- `src/preload/api/agents.ts` exposes `window.agentforge.agent.dispatch`.
- `src/renderer/modules/workspace/hooks/useWorkspaceController.ts` already knows
  how to turn a dispatch result into the active workspace session.

The implementation should preserve the current boundary:

```text
PTY output -> main system module -> preload system events -> renderer terminal
renderer remediation click -> preload agent dispatch -> main agent module
```

The renderer may summarize terminal output, but it must not gain filesystem,
process, SQLite, or shell access.

## Proposed Data Model

Add a small shared contract for remediation context, likely in
`src/shared/contracts/system.ts` or a new `src/shared/contracts/remediation.ts`:

```ts
export interface TerminalFailureContext {
  terminalSessionId: string
  repoPath: string
  editorId: string
  editorName: string
  command?: string
  exitCode: number
  signal?: number
  outputTail: string
  capturedAt: number
}
```

Keep it serializable. Do not persist this object by default.

## Implementation Steps

1. Extract terminal capture logic from `BottomTerminalPanel.tsx` into a pure
   helper, for example:
   `src/renderer/modules/workspace/components/terminalFailureCapture.ts`.

2. Track recent output per terminal instance:
   - append PTY data events into a capped buffer,
   - strip ANSI sequences only for the generated agent prompt,
   - keep the rendered xterm output unchanged.

3. Detect failure on terminal exit:
   - if `exitCode === 0`, do nothing,
   - if `exitCode !== 0`, build `TerminalFailureContext`,
   - show a small inline `Fix with Agent` action in the terminal panel chrome or
     footer area for that terminal tab.

4. Generate the remediation prompt in a pure renderer helper:
   - include command if known,
   - include exit code/signal,
   - include repo path,
   - include a bounded output excerpt,
   - instruct the agent to identify root cause, patch the repo, and run focused
     verification.

5. Wire the click to existing dispatch:
   - call `window.agentforge.agent.dispatch({ projectId, prompt, threadId })`,
   - route the result through existing `onSessionStarted`,
   - open or focus the workspace run view.

6. Make command detection iterative:
   - first pass can label unknown shell failures as `terminal session exited`,
   - second pass can capture likely submitted commands by observing user input
     ending in Enter for the `shell` terminal only,
   - avoid pretending interactive editor exits are command failures.

7. Add focused tests:
   - ring buffer caps output correctly,
   - ANSI stripping keeps the remediation prompt readable,
   - non-zero exits create a remediation context,
   - zero exits do not,
   - prompt generation includes the failure output but respects caps.

8. Run verification:
   - `rtk npm test -- BottomTerminalPanel`
   - `rtk npm test -- terminalFailureCapture`
   - `rtk npm run build`

## UI Notes

- Keep the action compact. This is operational UI, not a modal-heavy flow.
- Prefer an icon plus short label: `Fix with Agent`.
- Disable the button while dispatch is in progress.
- If dispatch fails, show the existing workspace banner error pattern.
- Do not render large logs in cards; the terminal already contains the log.

## Risks

- Shell command detection can be unreliable for multiline commands and TUIs.
  Start with exit-based detection and bounded output context.
- Raw logs can include secrets. Do not persist them, keep buffers in memory, cap
  aggressively, and let the user explicitly click before dispatching.
- Bottom terminal sessions can run interactive editors. Restrict remediation
  prompts to the plain `shell` editor id first, or make editor-session fixes a
  separate follow-up.
- The existing right-panel `TerminalPanel` streams agent sessions, not arbitrary
  shell commands. It can receive a similar failure action later, but it is not
  the first place to solve failed `npm test`.

## Follow-Up Tracks

After the remediation flow lands:

- Move `src/main/swarm`, `src/main/agents`, and `src/main/router` into
  module-owned directories in small vertical slices.
- Expand routing with a local scorer only after remediation prompt quality and
  dispatch telemetry reveal concrete routing misses.
- Consider saving sanitized failure summaries as feedback signals, not raw
  terminal logs.
