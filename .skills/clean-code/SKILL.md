# Clean Code Skill

Use this as the execution checklist for AI implementation agents working in
Lobrecs Agent.

## Before Editing

- Read `AGENTS.md`.
- Read `docs/architecture/modular-architecture.md`.
- Read `docs/best-practices/clean-code.md`.
- Identify the owning feature module or the target module if the code has not
  been refactored yet.
- Check whether the change touches Electron security boundaries, agent approval,
  worktrees, process lifecycle, IPC, or persistence.

## Implementation Rules

- Preserve the main/preload/renderer separation.
- Keep privileged operations in the main process.
- Keep renderer access behind `window.agentforge`.
- Add or update shared contracts before wiring new cross-process behavior.
- Prefer module-owned services over adding more logic to large entry files.
- Keep changes scoped to the requested behavior.
- Do not store secrets anywhere persistent.
- Keep completed agent diffs auto-applied by main-process services; renderer
  diff views are review-only.
- Add focused tests for changed behavior.

## Refactor Rules

- Move code in small vertical slices.
- Keep public behavior stable while changing structure.
- Extract contracts first, then handlers, then services, then persistence, then
  renderer state.
- Avoid broad formatting churn during structural changes.
- Leave compatibility wrappers temporarily when they reduce migration risk.

## Done Criteria

- The code builds or the relevant focused verification has been run.
- Tests cover the changed behavior or the missing coverage is explicitly noted.
- Electron security boundaries are unchanged or stronger.
- New modules expose only intentional public APIs.
- `AGENTS.md` and docs remain accurate after the change.
