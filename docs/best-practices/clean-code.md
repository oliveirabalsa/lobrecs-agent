# Clean Code Best Practices

Use this guide for implementation work in Lobrecs Agent.

## Core Standards

- Make the smallest change that fully solves the problem.
- Prefer explicit types at module boundaries and inferred types inside small
  local scopes.
- Keep functions focused on one level of abstraction.
- Name values by business meaning, not by implementation detail.
- Keep side effects at the edges: IPC handlers, repositories, adapters,
  filesystem helpers, process runners, and UI event handlers.
- Do not hide important workflow decisions behind clever abstractions.
- Delete dead code when the change makes it obsolete.

## TypeScript

- Keep strict-mode compatibility. Do not weaken types to make an error go away.
- Avoid `any`. Use `unknown` at boundaries and narrow it quickly.
- Prefer discriminated unions for agent events, session states, routing
  decisions, and approval states.
- Use readonly data when a function should not mutate inputs.
- Keep cross-process DTOs serializable. Avoid classes, functions, dates, maps,
  sets, errors, and library objects in IPC results.
- Validate untrusted or user-controlled input before it reaches application
  services.

## Electron Security

- Keep `contextIsolation` enabled and `nodeIntegration` disabled.
- Do not import Node.js or Electron APIs in renderer code.
- Expose only narrow, task-specific APIs from preload.
- Do not expose raw `ipcRenderer`, generic invoke helpers, filesystem helpers,
  shell execution, or database handles to the renderer.
- Treat paths, prompts, model ids, command output, and agent-generated patches as
  untrusted input.
- Preserve automatic main-process application of completed agent diffs; keep the
  renderer diff UI review-only.

## Main Process

- Keep CLI execution, worktree management, filesystem writes, SQLite, dialogs,
  and global shortcuts in main-process modules.
- Wrap external systems behind small adapters.
- Keep process cleanup idempotent. Session cancellation and app shutdown should
  be safe to call more than once.
- Convert external errors into actionable messages at module boundaries.
- Avoid long singleton chains. Prefer explicit dependency injection for services
  that are tested.

## Renderer

- Keep user workflows clear and local to feature modules.
- Prefer controlled state and derived values over duplicated state.
- Do not let `App.tsx` become the owner of every workflow.
- Use stable component props and callbacks for feature boundaries.
- Keep loading, empty, error, disabled, and busy states visible.
- Do not start background agent work from render paths. Use event handlers or
  effects with precise dependencies.

## IPC

- Keep channel names stable and feature-scoped.
- Validate inputs before calling application services.
- Return typed, serializable results.
- Keep handler logic thin. Complex behavior belongs in services.
- Add or update preload types whenever IPC shape changes.
- Prefer one bridge method per user intent, not one generic method for every
  action.

## Persistence

- Keep SQL and row mapping behind stores or repositories.
- Keep migrations deterministic and append-only.
- Use transactions for multi-step writes that must succeed or fail together.
- Keep timestamps consistent. Use numbers if the surrounding code already uses
  epoch milliseconds.
- Do not store secrets in SQLite.

## Agent And Worktree Safety

- Treat every agent output as untrusted until reviewed.
- Isolate swarm work in worktrees.
- Keep automatic diff application in main-process services.
- Preserve the distinction between an approval request and a diff proposal.
- Apply completed session diff proposals automatically before publishing them
  for review.
- Make cancellation clean up process handles and temporary worktrees.

## Testing

- Add focused tests beside the source as `*.test.ts`.
- Test pure domain rules directly.
- Test application services with fake adapters/repositories.
- Test persistence mappings when migrations or row conversion change.
- Test preload shape when renderer-facing API changes.
- Prefer focused Vitest runs while developing, then run the broader relevant
  command before handoff.

## Error Handling

- Use typed states for expected failures.
- Throw errors for impossible states or infrastructure failures that should stop
  the workflow.
- Show user-facing errors that explain what failed and what action was blocked.
- Do not swallow errors unless cleanup must remain best-effort; leave a comment
  only when the reason is not obvious.

## File Organization

- Keep feature-owned files near the feature.
- Use barrel exports only for public module APIs.
- Avoid circular dependencies. If a cycle appears, extract a shared contract or
  invert the dependency behind an interface.
- Do not mix renderer components with main-process services.
- Do not place feature-specific code in global shared folders because it is
  convenient.
