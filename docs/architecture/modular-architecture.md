# Modular Architecture

This is the target architecture for Lobrecs Agent. The app is currently split
mostly by Electron process and technical category. The next refactor should move
the code toward process-aware feature modules with explicit public contracts.

## Goals

- Keep Electron security boundaries obvious.
- Make every feature own its domain logic, application service, IPC handler, UI,
  tests, and persistence adapter where applicable.
- Keep shared contracts stable and easy to review.
- Make agent orchestration, diff approval, and worktree isolation hard to break
  accidentally.
- Let future features be added by creating or extending one module instead of
  touching unrelated buckets.

## Non-Negotiable Boundaries

- Renderer code must never import Node.js, Electron main APIs, SQLite, `node-pty`,
  filesystem APIs, child process APIs, or shell helpers directly.
- Renderer-to-main access must go through the preload bridge in
  `src/preload/index.ts`.
- Main process modules own privileged work: CLI execution, filesystem writes,
  worktree management, SQLite access, dialogs, shell integration, and global
  shortcuts.
- Shared code must contain only serializable types, schemas, constants, and pure
  utilities that are safe in both main and renderer.
- Applying an agent diff to disk must remain an explicit user-approved action.
- API keys and provider secrets must never be stored in code, local storage, or
  SQLite.

## Target Source Layout

```text
src/
  main/
    app/
      bootstrap.ts
      createWindow.ts
      shortcuts.ts
    modules/
      agents/
        application/
        domain/
        infrastructure/
        ipc/
        index.ts
      automations/
      cost/
      diffs/
      projects/
      routing/
      sessions/
      swarms/
      system/
      worktrees/
    shared/
      db/
      errors/
      ipc/
      logging/
  preload/
    api/
      agents.ts
      automations.ts
      cost.ts
      diffs.ts
      projects.ts
      sessions.ts
      swarms.ts
      system.ts
    index.ts
  renderer/
    app/
      App.tsx
      providers.tsx
      routes.tsx
    modules/
      automations/
      cost/
      projects/
      sessions/
      swarms/
      workspace/
    shared/
      components/
      hooks/
      state/
      ui/
  shared/
    contracts/
      agents.ts
      automations.ts
      cost.ts
      diffs.ts
      projects.ts
      sessions.ts
      swarms.ts
      system.ts
    types/
    utils/
```

The exact file names can evolve, but the boundaries should not.

## Module Shape

Each main-process feature module should follow this shape when it has enough
behavior to justify the split:

```text
modules/<feature>/
  domain/
    <entity>.ts
    <feature>.rules.ts
  application/
    <feature>Service.ts
  infrastructure/
    <feature>Repository.ts
    <externalAdapter>.ts
  ipc/
    register<Feature>Handlers.ts
  index.ts
```

- `domain` contains pure rules, value objects, and invariants.
- `application` coordinates use cases and enforces workflow order.
- `infrastructure` touches SQLite, filesystem, agents, shell commands, or other
  external systems.
- `ipc` maps validated IPC payloads to application services.
- `index.ts` exports the module public API only.

Small modules can start flatter, but do not mix renderer code, preload code, and
main-process infrastructure in the same directory.

## Renderer Module Shape

Renderer modules should group UI and state by user workflow:

```text
renderer/modules/<feature>/
  components/
  hooks/
  state/
  views/
  index.ts
```

- Components should receive domain data through props or module hooks.
- Hooks may call `window.agentforge`, but low-level bridge calls should be kept
  in one small client file per module when a workflow grows.
- Shared UI primitives belong in `renderer/shared/ui`; feature-specific
  components stay inside the feature module.
- Avoid putting large workflow state in `App.tsx`. `App.tsx` should compose
  modules and providers, not own feature internals.

## Shared Contracts

Move cross-process types from one large shared file into feature contract files
as the refactor progresses:

```text
shared/contracts/sessions.ts
shared/contracts/projects.ts
shared/contracts/swarms.ts
```

Contracts should contain:

- IPC request and response types.
- Serializable DTOs.
- Narrow string unions used across process boundaries.
- Runtime validation helpers when untrusted input crosses a boundary.

Contracts should not contain:

- SQLite row mapping.
- Electron, Node.js, React, or DOM imports.
- Service instances or mutable singletons.
- Provider secrets or environment-specific config.

## Dependency Direction

Use this dependency direction:

```text
renderer modules -> preload api -> shared contracts <- main ipc -> main application -> domain
main application -> infrastructure
```

Rules:

- Domain must not import application, infrastructure, IPC, Electron, or React.
- Application can import domain and infrastructure interfaces.
- Infrastructure can import external libraries and persistence adapters.
- IPC can import contracts and application services.
- Renderer can import contracts and renderer shared UI, but not main modules.

## IPC Design

- Name channels by feature and action, such as `sessions:list-events`.
- Keep handler files small. A handler should validate input, call a service, and
  return a serializable result.
- Prefer explicit parameters over generic `payload: unknown`.
- Mirror every new IPC channel in `src/preload/index.ts` or a split preload API
  file.
- Add tests for non-trivial IPC input handling through service-level tests first;
  add preload tests when the bridge shape changes.

## Persistence

- Keep SQLite access in repositories or stores owned by a module.
- Keep migrations centralized until a dedicated migration runner exists.
- Map database rows to shared DTOs at the persistence boundary.
- Never expose raw database rows to renderer code.
- Keep migrations backward compatible. Do not rewrite existing migrations after
  they have shipped.

## Refactor Sequence

Refactor incrementally in this order:

1. Extract shared contracts by feature from `src/shared/types.ts`.
2. Split the preload API by feature while preserving the existing
   `window.agentforge` shape.
3. Move main IPC handlers from one large registration file into feature modules.
4. Extract application services behind each IPC group.
5. Move persistence code behind module repositories.
6. Move renderer workflow state from `App.tsx` into feature modules.
7. Add module barrel exports where they clarify public API ownership.

Each step should leave the app building and tests passing.

## Example Feature Boundary

For sessions:

- `shared/contracts/sessions.ts` owns `Session`, `SessionStatus`, `AgentEvent`,
  and session IPC types.
- `main/modules/sessions/domain` owns status rules and event interpretation.
- `main/modules/sessions/application/SessionService.ts` dispatches, approves,
  rejects, cancels, records usage, and broadcasts events.
- `main/modules/sessions/infrastructure/SessionsRepository.ts` owns SQLite
  reads and writes.
- `main/modules/sessions/ipc/registerSessionHandlers.ts` registers
  `sessions:*` and `agent:*` session actions.
- `renderer/modules/sessions` owns terminal output, active session state,
  approval banners, and session tabs.

## Architecture Review Checklist

- Does the change keep privileged operations in the main process?
- Does the renderer only use the preload bridge?
- Is the feature behavior owned by one module?
- Are contracts serializable and free of framework/runtime imports?
- Are domain rules testable without Electron, React, SQLite, or shell commands?
- Are application workflows covered by focused unit tests?
- Did the change avoid unrelated refactors?
