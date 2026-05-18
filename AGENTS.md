# AGENTS.md - Lobrecs Agent

## What This Project Is

Electron desktop app that acts as a harness for multiple AI coding agents
(Claude Code, Codex CLI, OpenCode). It selects models by task complexity and
orchestrates swarms across isolated worktrees.

## Stack

- Electron 33+ with contextIsolation enabled
- React 19 + TypeScript strict mode
- Tailwind CSS v4
- SQLite through better-sqlite3 for local persistence
- xterm.js + node-pty for terminal output
- Monaco Editor for diff review

## Critical Rules

- Never store API keys in code, local storage, or SQLite.
- Renderer access to Node.js must go through `src/preload/index.ts`.
- Apply completed agent diffs automatically; use the diff UI only for review.
- Use Conventional Commits: `feat(scope): msg` or `fix(scope): msg`.
- Prefix local shell commands with `rtk`.

## Project Docs

- Start with `docs/README.md` for the local documentation map.
- Read `docs/architecture/modular-architecture.md` before structural work,
  module extraction, IPC changes, preload changes, or renderer workflow changes.
- Follow `docs/best-practices/clean-code.md` for implementation standards.
- Follow `docs/best-practices/clean-review.md` when reviewing code.
- Use `.skills/clean-code/SKILL.md` as the checklist for coding agents.
- Use `.skills/clean-review/SKILL.md` as the checklist for review agents.

## Architecture Direction

- Move toward process-aware feature modules: shared contracts, main-process
  application services, infrastructure adapters, IPC registration, and renderer
  workflow modules.
- Keep privileged capabilities in the main process and expose only narrow,
  typed preload APIs to the renderer.
- Keep domain rules testable without Electron, React, SQLite, shell commands, or
  filesystem access.
- Avoid adding more feature logic to large central files when a module-owned file
  can own the behavior.

## Run The Project

- `npm run dev` starts the Electron app in development mode.
- `npm test` runs Vitest.
- `npm run build` runs TypeScript checks and builds production assets.

## Conventions

- Barrel exports per module when useful.
- Tests live next to source as `*.test.ts`.
- Shared cross-process types currently live in `src/shared/types.ts`; split them
  into feature contracts during the modular architecture refactor.

## Renderer shell (post-refactor)

The renderer was rebuilt as a Codex-style chat IDE during the M0–M8 refactor.
Top-level layout:

- `src/renderer/app/RendererApp.tsx` — owns the resizable 2-pane shell
  (`Sidebar` + `WorkspaceView`) and Cmd+T / Cmd+W shortcuts.
- `src/renderer/components/Sidebar/` — project tree with collapsible threads,
  traffic-light-safe top zone, back/forward history arrows, and the new-chat
  action. Thread data comes from `window.agentforge.threads.list(projectId)`
  and stays live via `thread:updated` + per-session events.
- `src/renderer/modules/workspace/views/WorkspaceView.tsx` — top bar
  (`WorkspaceTopBar`), main-view tabs (workspace / costs / automations),
  the active session column (`RunWorkspace`), and the toggleable right
  panel (`DiffViewer` / `TerminalPanel`). State for the right panel is
  persisted to `localStorage`.
- `src/renderer/modules/workspace/components/MessageStream.tsx` +
  `groupTurns()` — turn-based message timeline rendered with
  `UserMessage`, `AssistantMessage`, and `WorkingState`.
- `src/renderer/modules/workspace/components/artifacts/` — turn artifacts:
  `RanCommandsPill`, `CommandPreview`, `EditedFilesCard` / `FileChangeRow`,
  `Callout`, `ApprovalRequestPill`, `CompletionFooter`.
- `src/renderer/modules/workspace/components/Composer/` — replaces the
  legacy `TaskInput`. Autosizing textarea, attach/approval-mode chips, a
  model-picker popover, and a circle send button that toggles to stop.
- `src/renderer/modules/workspace/components/modals/PlanPromptModal.tsx` —
  Radix `Dialog` for the `askPlanPrompt` round trip wired through
  `agent:plan-decision`.
- `src/renderer/components/ui/` — design tokens + primitives (`Button`,
  `Pill`, `Card`, `Divider`, `Spinner`, `Modal`).

Deprecated `TaskInput/`, `HistoryPanel/`, `TabBar/` directories and the
`src/renderer/store/tabs.tsx` shim were removed in M8. Tabs state still lives
at `src/renderer/modules/sessions/state/tabs.tsx` since the workspace
controller uses it internally for session bookkeeping.
