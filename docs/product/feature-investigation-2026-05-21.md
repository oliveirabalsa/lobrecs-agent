# Feature Investigation - 2026-05-21

## Purpose

This investigation identifies practical next features for Lobrecs Agent after
the Codex-style shell, project memory, repository context, swarm graph, quality
gate, settings, and update work already present in the app.

The recommendations are grounded in the current codebase and the product
direction in `AGENTS.md`, `docs/architecture/modular-architecture.md`,
`docs/best-practices/clean-code.md`, `.skills/clean-code/SKILL.md`, and the
existing `src/main/modules`, `src/renderer/modules`, and `src/shared/contracts`
surface.

## Competitive Signals

Current agent tools are converging on a few durable product primitives:

- OpenAI Codex CLI emphasizes local execution, approvals, images, local code
  review, subagents, web search, cloud tasks, scripting, MCP, and approval
  modes:
  https://developers.openai.com/codex/cli
- Codex subagents support specialized agents running in parallel and then
  collecting results into one response:
  https://developers.openai.com/codex/subagents
- Codex local review launches a dedicated reviewer over a chosen diff without
  touching the working tree:
  https://developers.openai.com/codex/cli/features#running-local-code-review
- OpenAI's iterative repair loop pattern separates review, repair, and
  validation, preserving an audit record for each pass:
  https://developers.openai.com/cookbook/examples/codex/build_iterative_repair_loops_with_codex
- Claude Code supports custom subagents with different model, tool, permission,
  hook, memory, background, and isolation configuration:
  https://code.claude.com/docs/en/sub-agents
- Claude Code hooks expose lifecycle points around tool calls, subagents,
  worktrees, compaction, and session end:
  https://code.claude.com/docs/en/hooks
- Cursor background agents provide asynchronous agents with status, follow-ups,
  and takeover:
  https://docs.cursor.com/background-agents
- Cursor Bugbot focuses on PR-diff review, comments, fix links, and
  path-scoped `.cursor/BUGBOT.md` review rules:
  https://docs.cursor.com/bugbot
- Windsurf distinguishes durable rules and AGENTS.md from less reliable
  auto-generated memory:
  https://docs.windsurf.com/windsurf/cascade/memories
- OpenCode highlights local/open operation, LSP context, multiple parallel
  sessions on one project, session sharing, desktop/IDE surfaces, and broad
  provider support:
  https://opencode.ai/

The strongest opportunity for Lobrecs Agent is not copying one surface. It is
combining these patterns into a local-first orchestration IDE: visible swarm
work, repo-local knowledge, auditable validation, and lightweight handoff to git
or PR review.

## Current Product Map

Already present or partially present:

- Projects and threads through `src/main/modules/projects`,
  `src/shared/contracts/projects.ts`, `src/shared/contracts/threads.ts`, and the
  renderer sidebar/workspace.
- Sessions, events, queueing, plan review, approvals, terminal output, diff
  cards, and completion footers in `src/main/modules/sessions` and
  `src/renderer/modules/workspace`.
- Swarm orchestration with managed/parallel/sequential/fan-out strategy,
  manager-plan parsing, and a renderer swarm graph in `src/main/modules/swarms`
  and `src/renderer/modules/swarms`.
- Repo-local learned memory in `.lobrecs/memory.json` through
  `src/main/modules/memory` and `docs/features/memory.md`.
- Repository context indexing/search/prompt injection through
  `src/main/modules/context`.
- Automated QA and self-healing repair through `src/main/modules/quality`.
- Settings, verification recipes, cost pricing, model maps, and swarm templates
  through `src/main/modules/settings` and `src/renderer/modules/settings`.
- Automations CRUD and run-now flow through `src/main/modules/automations` and
  `src/renderer/components/AutomationManager`.
- Git commit planning, split commit suggestions, execute, and push through
  `src/main/modules/git` and `src/shared/contracts/git.ts`.
- App update checks and release guidance through `docs/features/updates.md` and
  the updates module.

Gaps worth addressing:

- The approval-mode chip was visual-only at investigation time and has since
  been wired into dispatch.
- Automations have CRUD and manual run, but no scheduler loop or review queue
  for generated outputs.
- The repo context engine retrieves snippets, but the user cannot inspect or
  tune the index from the workspace.
- The quality gate emits command/step events, but there is no first-class audit
  timeline for review -> repair -> validate loops.
- There is no Cmd+K/search palette, and the manual M8 test plan explicitly
  deferred this.
- There is no PR-review flow even though the git module already understands
  changed files, branches, and commit plans.

## Feature Candidates

### 1. Approval Mode Wiring

User value: the composer permission posture becomes real instead of cosmetic.
Users can switch between manual approve, auto-safe, and full access per run.

Fit: settings already define `execution.defaultApprovalMode`, agent runtime
permission modes, and command-prefix warnings. The renderer already has
`ApprovalModeChip`.

Likely implementation:

- Add a shared dispatch approval field to `src/shared/contracts/sessions.ts` or
  the relevant agent dispatch contract.
- Thread the selected approval mode from
  `src/renderer/modules/workspace/components/Composer` into dispatch.
- Map the mode inside the main session manager/agent adapter boundary.
- Persist only non-secret preferences, either per project override or local
  UI preference.

Size: small to medium.

Risk: approval semantics vary by agent adapter. Keep the contract explicit and
fall back to the agent runtime default when a provider cannot honor a mode.

### 2. Automation Scheduler With Review Queue

User value: recurring tasks become useful without requiring the user to click
run-now. Outputs land in a review queue instead of silently changing code.

Fit: automation CRUD, schedules, enabled flags, and run-now already exist. The
settings docs already describe verification recipes and workflow UI.

Likely implementation:

- Add an application scheduler service under
  `src/main/modules/automations/application`.
- Keep cron parsing and due-run decisions in a pure domain helper with tests.
- Emit automation-run activities into the same thread/session surfaces already
  used by normal agent runs.
- Add a renderer queue section in the automations view for last run, next run,
  status, failed verification, and review action.

Size: medium.

Risk: background scheduling in Electron can create surprising work. Require an
explicit enabled toggle and show the next run time before activating.

### 3. Review Agent For Local Diffs And PR Prep

User value: users get prioritized code-review findings before commit or PR,
without waiting for external CI or GitHub review bots.

Fit: the git module already snapshots changed files and can run a lightweight
analysis agent for commit grouping. The workspace already has diff review
surfaces.

Likely implementation:

- Add `git:review` or `review:local-diff` IPC over selected diff scopes:
  working tree, staged, branch vs upstream, or a specific commit.
- Reuse the commit snapshot machinery where possible, but produce findings
  instead of commit suggestions.
- Render findings as inline review cards linked to file paths and diff tabs.
- Allow "Fix with agent" to dispatch a follow-up on the same thread.

Size: medium.

Risk: noisy reviews are worse than no review. Use the clean-review checklist and
ask for bugs, regressions, security issues, and missing tests first.

### 4. Repository Context Explorer

User value: users can see what the agent is likely to retrieve, why a snippet
was selected, and when an index is stale.

Fit: `RepositoryContextService` already indexes, searches, and builds prompt
context. The current gap is observability and control.

Likely implementation:

- Add a workspace panel for index status, reindex action, search query, and top
  retrieved snippets.
- Show path, line range, score, content preview, skipped file count, and index
  timestamp.
- Add settings for max prompt snippets and max prompt characters.
- Keep filesystem reads in main and expose only typed context IPC.

Size: medium.

Risk: users may over-trust scores. Label the panel as retrieved context, not
ground truth.

### 5. Auditable Repair Timeline

User value: "done" means the agent changed files, ran checks, and either passed
or produced a clear remaining failure. Users can audit every repair attempt.

Fit: `runQualityGate` already has review-like phases: automated QA started,
commands, failure summary, and self-healing repair dispatch. The product needs
an explicit timeline and record model.

Likely implementation:

- Add a quality-run contract with attempt number, changed files, recipes,
  command results, repair session id, stop reason, and final status.
- Persist quality-run records in SQLite.
- Render a compact "QA timeline" artifact in the message stream and right
  panel.
- Stop conditions should include passed, max attempts, repeated failure delta,
  and human review required.

Size: medium to large.

Risk: audit data can grow quickly. Keep outputs truncated according to existing
verification settings.

### 6. Cmd+K Search Palette

User value: fast navigation across projects, threads, sessions, commands,
files, memories, settings, and automations.

Fit: the M8 manual test plan explicitly deferred search. The renderer now has a
stable two-pane shell and module-owned views.

Likely implementation:

- Add a renderer command palette module with indexed local data from existing
  preload APIs.
- Start with project/thread/session/settings navigation.
- Add second-phase file/context/memory search via existing context and memory
  IPC.
- Keep all privileged filesystem search in main modules.

Size: small to medium for navigation; medium for repository search.

Risk: command palettes rot when actions are untyped. Define a small action
registry rather than hard-coded click handlers scattered through the renderer.

### 7. Agent Capability Health Check

User value: before dispatching a task, the app can tell whether Claude Code,
Codex, OpenCode, Antigravity, git, Node, and required native modules are ready.

Fit: settings already store runtime commands and model maps. The app has had
native-module and CLI availability friction, so a visible readiness view would
reduce failed runs.

Likely implementation:

- Add `system:doctor` checks for configured agent commands, auth hints,
  `rtk`, git, Node, native modules, and repo writeability.
- Render checks in settings and as a warning before starting a run when a
  selected agent is unhealthy.
- Keep secret detection limited to presence/absence hints; never echo tokens.

Size: medium.

Risk: checks can be slow or brittle. Run on demand first, then cache results.

### 8. Memory Promotion Workflow

User value: useful learned facts can be promoted from ephemeral session notes
into durable repo rules or AGENTS.md updates with review.

Fit: project memory exists, Windsurf/Cursor signals show that durable rules are
more trustworthy than silent memory, and this repo already treats AGENTS.md and
`.skills` as coding contracts.

Likely implementation:

- Add suggested memory cards after positive feedback or repeated failures.
- Let users accept, edit, reject, or promote an item to `.lobrecs/memory.json`,
  `.skills`, or `AGENTS.md` via a reviewed diff.
- Use a denylist for secrets and local credentials before writing memory.

Size: medium.

Risk: memory pollution. Require explicit user action for promotion and keep
source metadata.

### 9. Agent Templates And Role Marketplace

User value: users can reuse high-quality roles such as security reviewer,
migration planner, test writer, bug reproducer, release manager, or docs
maintainer across projects.

Fit: swarm templates already exist in settings. Claude Code and Codex both lean
into custom/specialized agents.

Likely implementation:

- Expand swarm templates into editable role cards with model, tools/adapter,
  permission mode, prompt suffix, max turns, and verification recipe.
- Support project-level role overrides without storing secrets.
- Add import/export as JSON for sharing.

Size: medium.

Risk: role templates can become vague prompt piles. Validate each template with
a required role, expected output, constraints, and done criteria.

### 10. PR Handoff Pack

User value: after commit/push, the app can generate a clean PR summary,
verification notes, risk notes, screenshots, and reviewer checklist.

Fit: git commit workflow already creates grouped commits and pushes. Updates,
quality, and diff modules already know useful handoff data.

Likely implementation:

- Add a local PR pack artifact before external GitHub integration.
- Include changed files, commits, QA results, open risks, and suggested PR body.
- Later add GitHub connector/CLI support for opening the PR.

Size: small for local artifact; medium with GitHub automation.

Risk: stale summaries if the tree changes after analysis. Reuse the git
fingerprint pattern from commit planning.

## Prioritization

| Rank | Feature | Impact | Complexity | Why now |
| --- | --- | --- | --- | --- |
| 1 | Approval Mode Wiring | High | Small-medium | A visible control currently over-promises; wiring it improves trust immediately. |
| 2 | Review Agent For Local Diffs And PR Prep | High | Medium | Fits existing git/diff surfaces and gives a clear daily workflow win. |
| 3 | Repository Context Explorer | High | Medium | Makes the new context engine inspectable and easier to trust. |
| 4 | Auditable Repair Timeline | High | Medium-large | Builds on self-healing work and makes "tested" product-observable. |
| 5 | Automation Scheduler With Review Queue | High | Medium | Turns an existing tab into real background value. |
| 6 | Cmd+K Search Palette | Medium-high | Small-medium | Explicitly deferred and useful once threads/projects grow. |
| 7 | Agent Capability Health Check | Medium | Medium | Reduces failed dispatches and support friction. |
| 8 | Memory Promotion Workflow | Medium | Medium | Strengthens repo-local knowledge without silent memory drift. |
| 9 | PR Handoff Pack | Medium | Small-medium | Complements commit flow and can ship incrementally. |
| 10 | Agent Templates And Role Marketplace | Medium | Medium | Valuable, but depends on stable role execution and settings UX. |

## Best Next Bets

1. Approval Mode Wiring

   This should be first because the UI already advertises it. It is a contained
   cross-process contract task and reduces product mismatch.

2. Local Diff Review Agent

   This gives the app a daily "before commit" workflow that is easier to trust
   than another broad agent-run mode. It should use the clean-review checklist
   and render findings directly beside diffs.

3. Repository Context Explorer

   The repo already has automatic retrieval. The next step is making it visible,
   tunable, and debuggable so users understand what context the agent saw.

## Quick Wins

- Wire composer approval mode into dispatch and settings.
- Add Cmd+K navigation for projects, threads, and settings only.
- Add manual "review current diff" using existing git snapshot code.
- Add context index status and manual reindex button.
- Add next-run display and due/overdue badges for automations before building
  the full scheduler.

## Larger Initiatives

- Full automation scheduler with review queue and quality gates.
- Persistent quality-run records and repair timelines.
- Memory promotion to `.lobrecs/memory.json`, `.skills`, or `AGENTS.md`.
- GitHub PR creation and PR-review comment integration.
- Project-level agent template library with import/export.

## Architecture Notes

- New features should be vertical modules where possible: shared contract, main
  service, infrastructure adapter, IPC registration, preload API, and renderer
  workflow view.
- Do not add more feature logic to `WorkspaceView` unless it is only routing
  state to an owned module. The workspace file is already a high-pressure
  integration surface.
- Keep repo scans, git, shell, and filesystem access in main process modules.
- Favor pure domain helpers for schedule calculation, review finding
  normalization, quality-run stop conditions, and context-ranking settings.
- Treat model output as untrusted. Review findings, commit plans, manager plans,
  memory suggestions, and repair judgments should be schema-validated before
  they affect UI state or files.

## Suggested First Implementation Slice

Feature: approval mode wiring.

1. Add a serializable approval-mode field to the dispatch contract.
2. Convert the renderer composer mode (`manual`, `auto-safe`, `full`) to the
   main-process permission mode contract.
3. Thread the value through `WorkspaceView`, workspace controller dispatch, and
   the session manager.
4. Map unsupported provider modes to the safest available equivalent and emit a
   visible activity note when fallback happens.
5. Add tests for mode normalization and dispatch payload formation.

Acceptance criteria:

- Changing the chip changes the next session's actual agent runtime permission.
- The selected mode is visible in the run metadata.
- Unsupported modes do not silently become full access.
- Existing default settings still apply when the user does not choose a mode.
