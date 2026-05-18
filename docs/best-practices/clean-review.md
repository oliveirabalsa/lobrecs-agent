# Clean Review Best Practices

Use this guide when reviewing changes in Lobrecs Agent.

## Review Priorities

Review findings come before summaries. Order findings by severity:

1. Security, data loss, secret exposure, or unintended filesystem writes.
2. Broken approval, diff, worktree, cancellation, or process lifecycle behavior.
3. Cross-process boundary violations.
4. User-visible regressions.
5. Type, persistence, migration, or test gaps.
6. Maintainability issues that will make the next change risky.

If there are no findings, say that directly and list any residual risk or tests
that were not run.

## Project Invariants To Check

- API keys and secrets are not stored in code, local storage, or SQLite.
- Renderer code does not access Node.js, Electron main APIs, SQLite, `node-pty`,
  filesystem APIs, child processes, or shell execution directly.
- Preload exposes narrow methods, not raw `ipcRenderer`.
- Agent diffs should be applied automatically by the main process, with renderer
  diffs used for review only.
- Swarm agents operate in isolated worktrees.
- IPC payloads and results are serializable and typed.
- Paths, prompts, model ids, terminal output, and agent patches are treated as
  untrusted input.
- Tests live beside source files as `*.test.ts`.

## Architecture Review

- Does the change keep the dependency direction from the architecture guide?
- Is new behavior owned by a feature module instead of a global bucket?
- Is domain logic separated from Electron, React, SQLite, and shell commands?
- Are shared types actually shared contracts, or did feature internals leak into
  shared code?
- Did the change expand `App.tsx`, `src/main/ipc/index.ts`, or
  `src/shared/types.ts` when a module-owned file would be cleaner?

## Testing Review

Check whether tests cover the risk:

- Pure rules should have direct unit tests.
- Application services should have fake dependencies.
- Persistence changes should test migrations and row mapping.
- IPC/preload changes should test bridge shape or service behavior.
- UI workflow changes should cover state transitions where feasible.

Do not demand broad tests for tiny docs or copy-only changes. Do call out missing
tests when behavior changes without focused coverage.

## Review Comment Style

- Be specific and actionable.
- Reference exact files and lines when possible.
- Explain the runtime consequence, not just the style preference.
- Do not include large rewrites unless the fix is small enough to show clearly.
- Separate blocking issues from non-blocking suggestions.
- Avoid repeating the same issue for every occurrence; group related examples.

## Review Output Format

Use this structure:

```text
Findings
- [P1] Short title - path:line
  Explain what breaks, when it breaks, and the smallest credible fix.

Open questions
- List only questions that affect correctness or scope.

Verification
- Commands run, or "Not run" with a reason.
```

Severity levels:

- `P0`: data loss, secret leak, remote code execution, or app unusable.
- `P1`: likely production bug, security boundary break, or broken core workflow.
- `P2`: correctness issue with narrower conditions or missing important tests.
- `P3`: maintainability or polish issue that does not block the change.
