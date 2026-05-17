# Clean Review Skill

Use this as the execution checklist for AI review agents working in Lobrecs
Agent.

## Before Reviewing

- Read `AGENTS.md`.
- Read `docs/architecture/modular-architecture.md`.
- Read `docs/best-practices/clean-review.md`.
- Inspect the changed files and the surrounding owner module.
- Check tests related to the changed behavior.

## Review Focus

- Look for concrete bugs before style issues.
- Verify Electron security boundaries.
- Verify explicit approval before disk writes.
- Verify worktree isolation for swarm behavior.
- Verify IPC contracts, preload exposure, and renderer usage stay aligned.
- Verify persistence changes are migrated, mapped, and tested.
- Verify cancellation and cleanup paths for long-running processes.

## Output Rules

- Put findings first.
- Include severity, file, and line when possible.
- Explain the user-visible or runtime consequence.
- Keep summaries short.
- If no issues are found, say so directly and mention residual test gaps.

## Anti-Patterns To Flag

- Renderer imports from `electron`, `node:*`, `better-sqlite3`, `node-pty`, or
  main-process modules.
- Raw `ipcRenderer` exposed to the renderer.
- Generic IPC channels that bypass typed contracts.
- Agent patches applied without explicit approval.
- Secrets persisted in code, SQLite, or browser storage.
- Feature behavior added to `App.tsx` or `src/main/ipc/index.ts` when it should
  be module-owned.
- Tests that only assert implementation details while missing the workflow risk.
