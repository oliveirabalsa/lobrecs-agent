# Feature Investigation Addendum - 2026-05-21

## Purpose

This is a second-pass companion to
`docs/product/feature-investigation-2026-05-21.md`. It does not replace the
first investigation. It updates the baseline with a read-only code scan and
adds live web-researched signal from current agent products.

The first document already ranked Approval Mode Wiring first. At the time of
this addendum, that work is in progress in the working tree: the shared agent
dispatch contract has an `AgentApprovalMode`, renderer dispatch paths pass the
mode forward, and `src/main/modules/agents/domain/approvalMode.ts` maps it to
runtime permission modes. Because that work is not the subject of this
addendum, the recommendations below treat it as "nearly addressed" but still
worth finishing and verifying.

## Codebase Delta

The first investigation correctly identified the major app surfaces, but a few
areas are already more developed than its ranking implied.

### System Module

Current state:

- `src/shared/contracts/system.ts` already exposes editor detection, markdown
  preview reads, image attachment saving, CLI editor terminal sessions, agent
  capability records, and terminal failure context.
- `src/main/modules/system/ipc/registerSystemHandlers.ts` already has
  `system:check-agent`, `system:list-agent-models`,
  `system:list-capabilities`, verification recipe listing, editor launch, and
  CLI editor terminal handlers.

Implication:

The "Agent Capability Health Check" candidate should not start from scratch.
The first useful slice is an opinionated doctor surface that composes existing
capability checks with missing runtime checks: configured command resolution,
auth hint presence, git readiness, repo writeability, native module health, and
MCP/plugin availability.

### Runs Module

Current state:

- `src/shared/contracts/runs.ts` already models spec runs, run attempts,
  verification recipes, verification results, adapter capabilities, and
  normalized agent events.
- `src/main/modules/runs/ipc/registerRunHandlers.ts` can start approved specs,
  dispatch one or more attempts, cancel runs, compare runs, and execute
  verification commands.

Implication:

The missing piece is not "run execution" in general. It is durable audit and
replay across the full review -> repair -> validate loop. This makes the
original "Auditable Repair Timeline" candidate stronger, because the contracts
already contain much of the vocabulary.

### Routing Module

Current state:

- `src/shared/contracts/routing.ts` has a typed `RoutingDecision`.
- `src/main/modules/routing/ipc/registerRoutingHandlers.ts` exposes
  `router:preview`, including recent failure hints from feedback.

Implication:

Routing explainability is closer than it looked. A small "why this model"
surface could expose preview decisions before dispatch and record actual route
decisions in session metadata, without building a full model-router product.

### Repository Context

Current state:

- `src/shared/contracts/context.ts` already includes index result, status, and
  search result DTOs with path, line range, score, and content.
- `src/main/modules/context/ipc/registerContextHandlers.ts` exposes
  `context:index`, `context:status`, and `context:search`.
- The workspace composer already shows a project context percentage, but there
  is no first-class explorer for retrieved snippets or index tuning.

Implication:

The Repository Context Explorer is a smaller and better next bet than the first
doc implied. Backend IPC already exists; the remaining work is mostly renderer
workflow, settings, and transparent display of retrieved snippets.

### Automations

Current state:

- `src/shared/contracts/automations.ts` models prompt, cron string, agent,
  enabled flag, and `lastRunAt`.
- `src/main/modules/automations/ipc/registerAutomationHandlers.ts` supports
  list/create/update/delete and manual run-now.
- `src/renderer/components/AutomationManager/index.tsx` can create, toggle,
  run, delete, and inspect automations with recent run timestamps.

Implication:

Automations need scheduler semantics, due/overdue calculation, run records, and
review inbox behavior. CRUD is not the problem anymore.

### Costs

Current state:

- `src/renderer/components/CostDashboard/index.tsx` already shows project and
  model breakdowns, period filters, summary tiles, and CSV export.
- Cost is already visible in completion footers and session headers.

Implication:

Cost does not need a broad dashboard initiative right now. Better next work is
budget guardrails tied to dispatch and automations: "this run is expensive,"
monthly budget warnings, and per-agent cost attribution in review/audit
records.

### Search Palette

Current state:

- `src/renderer/components/SearchPalette/index.tsx` exists and is wired to
  Cmd+K from `src/renderer/app/RendererApp.tsx`.
- The current palette searches projects and threads via
  `window.agentforge.threads.search(...)`.

Implication:

The first investigation's "Cmd+K Search Palette" gap is partly stale. The next
slice should be "unified command palette," extending the existing palette to
settings, automations, memory, context snippets, git actions, and run artifacts.

### Memory

Current state:

- `src/renderer/components/MemoryManager/index.tsx` already exposes project
  memory search, category filters, create/edit/delete, and
  `.lobrecs/memory.json` visibility.
- Feedback can already feed learned project memory through the memory module.

Implication:

Memory Promotion Workflow remains valuable, but the sharper opportunity is
reviewed promotion from volatile session evidence into durable repository
artifacts: `.lobrecs/memory.json`, `.skills`, or `AGENTS.md`.

## Web Research Summary

Sources were checked live on 2026-05-21. Official documentation and official
changelogs were preferred. Reddit, secondary roundups, and unrelated mirror
pages were ignored unless useful only as weak ecosystem color; the feature
recommendations below rely on official or primary sources.

### Sources Used

- OpenAI Codex CLI features:
  https://developers.openai.com/codex/cli/features
- OpenAI Codex subagents:
  https://developers.openai.com/codex/subagents
- OpenAI Codex app automations:
  https://developers.openai.com/codex/app/automations
- OpenAI Codex app worktrees:
  https://developers.openai.com/codex/app/worktrees
- OpenAI Codex app computer use:
  https://developers.openai.com/codex/app/computer-use
- OpenAI Codex sandboxing:
  https://developers.openai.com/codex/concepts/sandboxing
- OpenAI iterative repair loop cookbook:
  https://developers.openai.com/cookbook/examples/codex/build_iterative_repair_loops_with_codex
- Claude Code subagents:
  https://docs.anthropic.com/en/docs/claude-code/sub-agents
- Claude Code hooks:
  https://docs.anthropic.com/en/docs/claude-code/hooks
- Claude app/Cowork release notes:
  https://docs.anthropic.com/ko/release-notes/claude-apps
- Cursor changelog:
  https://cursor.com/changelog
- Cursor subagents and skills changelog:
  https://prod.cursor.com/changelog/2-4
- Windsurf memories and rules:
  https://docs.windsurf.com/windsurf/cascade/memories
- Windsurf Cascade product page:
  https://windsurf.com/cascade
- OpenCode changelog:
  https://opencode.ai/changelog
- OpenCode agents:
  https://opencode.ai/docs/agents/
- Zed stable releases:
  https://zed.dev/releases/stable
- Zed Agent Panel docs:
  https://zedhub.dev/ai/agent-panel
- Amp owner manual:
  https://ampcode.com/manual
- Amp Chronicle/news index:
  https://ampcode.com/news
- Sourcegraph MCP server GA:
  https://sourcegraph.com/changelog/mcp-ga
- OpenAI Agents SDK tracing:
  https://openai.github.io/openai-agents-python/tracing/
- Official MCP Registry:
  https://prod.registry.modelcontextprotocol.io/

### Competitive Signals

Automation has moved from "run a prompt later" to a managed work inbox.
OpenAI Codex documents an automation pane with Triage, standalone scheduled
runs, thread automations, project automations, cron cadence, first-output
review guidance, sandbox caveats, and worktree cleanup. Cursor's May 2026
changelog similarly moves automations into the Agents Window and adds
multi-repo and no-repo automations.

Parallel agent orchestration is now table stakes, but products differ on how
visible it is. Codex, Claude Code, Cursor, OpenCode, Zed, and Amp all expose
subagents or adjacent multi-agent/thread behavior. The notable product
opportunity for Lobrecs Agent is not merely spawning more agents. It is making
the run graph, handoffs, intervention points, and final evidence easier to
inspect than a raw terminal stream.

Permissions and environment readiness are becoming explicit product surfaces.
OpenAI documents sandbox modes, approval policies, and auto-review boundaries.
OpenCode supports per-agent and per-tool permission rules, including MCP tool
patterns. Zed exposes tool approval behavior and warns when selected models
cannot use tools. Cursor highlights environment setup validation, missing
credential prompts, environment version history, rollback, egress controls, and
audit logs.

Review and repair are converging around auditable loops. OpenAI's iterative
repair pattern separates review, repair, and validation into structured phases.
Cursor is improving PR tab review states and Bugbot effort controls. Amp has
agentic review and review panels. This reinforces the original Local Diff
Review and Auditable Repair Timeline candidates.

Durable project knowledge is shifting toward explicit, versioned files rather
than opaque memory. Windsurf recommends Rules or `AGENTS.md` for durable team
knowledge. Amp automatically includes `AGENTS.md`, supports subtree guidance,
can search/reference prior threads, and exposes which agent files are in use.
This aligns strongly with the repo's current docs/skills contract.

Context surfaces are becoming user-visible and tunable. Zed shows token usage
near the agent composer and supports explicit `@` context for files,
directories, symbols, previous threads, rules, web pages, and images. Amp can
find prior threads by keyword, path, repo, author, date, or task. Lobrecs
Agent already retrieves snippets, but the user still cannot inspect why a
piece of context was included.

MCP is now broad enough to need governance. Cursor, Windsurf, OpenCode, Amp,
Zed, Sourcegraph, and OpenAI all expose MCP-related surfaces. The official MCP
registry and Sourcegraph MCP GA signal that users will expect install,
permission, auth, and health management rather than raw JSON configuration.

Computer/browser verification is a differentiator for desktop coding agents.
OpenAI Codex documents Computer Use for GUI tasks and recommends the in-app
browser first for local web apps. For an Electron app like Lobrecs Agent, this
suggests a future verification surface that can store screenshots, browser
logs, and visual check evidence next to quality runs.

Voice and pop-out workflows are no longer fringe. Codex app documents voice
dictation and floating thread windows. Cursor has improved voice input in its
Agents Window. These are not top-priority for Lobrecs Agent, but they shape the
workspace shell direction.

Observability is becoming a first-class engineering concern. OpenAI Agents SDK
tracing records generations, tool calls, handoffs, guardrails, and custom
events, while current agent frameworks and MCP ecosystems are converging on
OpenTelemetry-style traces. Lobrecs Agent already has session events; the gap
is persistent, queryable, user-facing audit records.

## New Or Reweighted Candidates

### A. Automation Triage Inbox And Scheduler

Status: reweighted from the original "Automation Scheduler With Review Queue".

User value: recurring work should create reviewable findings, not silent file
changes or one-off session links.

Codebase fit: strong. CRUD, enable/disable, run-now, schedule strings, and
manual run timestamps already exist.

Implementation sketch:

- Add pure schedule helpers under
  `src/main/modules/automations/domain/schedule.ts` to parse cron strings,
  calculate next run, and classify due/overdue.
- Add an application scheduler service under
  `src/main/modules/automations/application`.
- Persist automation runs with status, started/completed timestamps, session id,
  output summary, changed files, verification state, and unread/reviewed state.
- Emit automation activities into existing thread/session surfaces, but also
  maintain an automations triage inbox.
- Extend `src/shared/contracts/automations.ts` with automation run DTOs,
  scheduler status, next-run display, and review state.
- Extend `src/renderer/components/AutomationManager/` with an inbox section:
  due next, running, unread findings, failed verification, reviewed.

Vertical placement:

- `src/shared/contracts/automations.ts`
- `src/main/modules/automations/domain`
- `src/main/modules/automations/application`
- `src/main/modules/automations/ipc`
- `src/renderer/modules/automations` or move the existing component out of
  the global `components` bucket as the workflow grows.

Size: medium.

Risk: background work can surprise users. Require explicit enabled state,
show next-run time before activation, and default generated outputs to review
instead of silent acceptance.

### B. Run Audit Timeline

Status: stronger than in the first investigation.

User value: "done" should mean the app can show what was reviewed, repaired,
validated, retried, skipped, or left for the user.

Codebase fit: strong. `runs.ts`, `qualityGateService`, session activities, and
verification recipes already contain most primitives.

Implementation sketch:

- Add a `QualityRun` or `RunAuditRecord` contract with attempt number,
  phase, session id, recipe id, command, exit code, output tail, changed files,
  repair session id, stop reason, and final status.
- Persist audit records in SQLite and link them to sessions/spec runs.
- Render timeline artifacts in the message stream and a right-panel audit tab.
- Record validation evidence before dispatching self-healing repair.
- Add stop conditions for passed, max attempts, same failure repeated, no diff,
  manual review required, and user cancelled.

Vertical placement:

- `src/shared/contracts/quality.ts` or a new `runs` sub-contract if the audit
  should stay run-scoped.
- `src/main/modules/quality/application`
- `src/main/modules/runs` for spec-run integration.
- `src/renderer/modules/workspace/components/artifacts` for compact timeline
  cards.

Size: medium to large.

Risk: unbounded logs. Store structured summaries and truncated output tails,
not full terminal streams.

### C. Context Explorer And Prompt Evidence

Status: smaller than originally estimated because IPC already exists.

User value: users can inspect what context the agent saw, diagnose stale or
irrelevant retrieval, and tune future prompts.

Codebase fit: strong. Search, index, status, score, path, line range, and
snippet content contracts already exist.

Implementation sketch:

- Add a context panel reachable from the workspace composer context percentage.
- Show index status, indexed files/chunks, skipped files, updated time, and
  manual reindex.
- Add a search box that calls `window.agentforge.context.search(...)`.
- For each session, persist the context snippets injected into dispatch and
  expose them as "Prompt evidence."
- Add settings for max snippets and prompt character budget.

Vertical placement:

- `src/shared/contracts/context.ts`
- `src/main/modules/context/application`
- `src/main/modules/context/ipc`
- `src/renderer/modules/context` or `src/renderer/modules/workspace` if the
  first slice remains a workspace side panel.

Size: small to medium.

Risk: users may treat score as truth. Label results as retrieval evidence, not
ground truth.

### D. Local Diff Review Agent

Status: unchanged priority, but better framed by current competitor signal.

User value: before commit, users get prioritized findings tied to files and
diff hunks, with "Fix with agent" on the same thread.

Codebase fit: strong. Git diff, changed files, commit plan analysis, diff UI,
and clean-review project skill already exist.

Implementation sketch:

- Add `git:review-local-diff` IPC over `working-tree`, `staged`, `head`,
  branch-vs-upstream, or selected files.
- Reuse commit snapshot/fingerprint code to avoid stale reviews.
- Run a review-only agent prompt using `.skills/clean-review/SKILL.md`.
- Schema-validate findings: severity, file path, line/hunk hint, issue,
  rationale, suggested fix, confidence, test gap.
- Render findings as review cards linked to diff tabs.
- Add "Fix with agent" to dispatch a follow-up using the finding payload.

Vertical placement:

- `src/shared/contracts/review.ts` or extend `git.ts`.
- `src/main/modules/git/application` for diff collection.
- `src/main/modules/review` if review grows beyond git.
- `src/renderer/modules/workspace/components` for cards and right-panel
  integration.

Size: medium.

Risk: noisy reviews reduce trust. Start with bugs, regressions, security, and
missing verification only; avoid style comments by default.

### E. Unified Command Palette

Status: replaces the original "Cmd+K Search Palette" candidate.

User value: one launcher should navigate to threads, projects, settings,
automations, memory rules, context snippets, cost view, git actions, and run
artifacts.

Codebase fit: strong. `SearchPalette` and Cmd+K are already shipped for
thread/project search.

Implementation sketch:

- Keep the existing palette, but introduce typed result/action groups.
- Add static actions: new chat, settings sections, automations, memory, cost,
  refresh context index, review current diff.
- Add dynamic providers: thread search, memory search, automation search,
  context search for active project.
- Make every palette action return a typed command instead of embedding
  navigation click behavior in the palette.

Vertical placement:

- `src/renderer/components/SearchPalette` for the initial migration.
- Move to `src/renderer/modules/command-palette` when providers/actions grow.
- Add only typed preload methods when a command needs privileged work.

Size: small to medium.

Risk: action drift. Use a registry with stable action ids and focused tests for
keyboard navigation and dispatch.

### F. Agent Doctor And Environment Readiness

Status: reweighted downward as a large feature, upward as a quick operational
surface.

User value: failed dispatches should be preventable. The user should know if
the selected agent, auth, git repo, native modules, MCP servers, and command
prefix rules are ready.

Codebase fit: medium to strong. `system:list-capabilities`,
`system:check-agent`, settings, and model catalogs already exist.

Implementation sketch:

- Add `system:doctor` to aggregate capability checks.
- Check configured runtime command path, installed binary, auth status hints,
  model listing availability, git repo status, writeability, `rtk`, native
  module loading, MCP configuration health, and verification recipes.
- Show warnings in settings and pre-dispatch when selected runtime is not
  healthy.
- Never print tokens or secret values. Only report presence, absence, or auth
  command suggestions.

Vertical placement:

- `src/shared/contracts/system.ts`
- `src/main/modules/system/application/doctor.ts`
- `src/main/modules/system/ipc`
- `src/renderer/modules/settings`

Size: medium.

Risk: slow checks and false negatives. Run on demand first, cache short-lived
results, and keep checks explainable.

### G. MCP Server Manager

Status: new candidate.

User value: users need to see which MCP servers are available to each agent,
which tools they expose, how auth works, and which are allowed for a run.

Codebase fit: medium. Agent capability contracts already include
`supportsMcp`, but there is no MCP inventory or settings module.

Implementation sketch:

- Add an MCP contract with configured server, source agent, status, auth state,
  exposed tools, and permission policy.
- Start read-only: inventory known config files for Codex, Claude Code,
  OpenCode, and Cursor-compatible formats where safe.
- Add install/import later, potentially using the official MCP registry.
- Tie MCP tools into approval-mode display and per-run metadata.

Vertical placement:

- `src/shared/contracts/mcp.ts`
- `src/main/modules/mcp/application`
- `src/main/modules/mcp/infrastructure`
- `src/main/modules/mcp/ipc`
- `src/renderer/modules/settings` for first UI, later a dedicated module.

Size: medium.

Risk: secrets and auth. Never read or display token values; treat config paths
and headers as sensitive.

### H. Worktree Handoff And Snapshot Restore

Status: new, but intentionally not a near-term default.

User value: users can move a long-running task out of the foreground checkout
and later bring it back with a clear Git handoff.

Codebase fit: partial. `RunMode` has `worktree`, and git contracts include
worktree metadata, but project instructions currently say production-path
worktrees are disabled unless isolated runs are explicitly re-enabled.

Implementation sketch:

- Keep local runs as the default.
- Add a guarded experimental setting for isolated worktree runs.
- Track worktree path, base branch, base commit, dirty snapshot, associated
  thread, and cleanup policy.
- Add explicit handoff from worktree to local with diff preview and conflict
  checks.
- Save a snapshot before cleanup so reopened threads can show "restore work."

Vertical placement:

- Existing `src/shared/contracts/runs.ts` and `git.ts`.
- Future `src/main/modules/worktrees`.
- Workspace top bar and right panel for handoff controls.

Size: large.

Risk: high. Git worktrees are easy to make confusing. This should wait until
audit, review, and local diff flows are mature.

### I. Browser And Visual Verification Evidence

Status: new candidate.

User value: UI work should attach screenshots, browser logs, and replay notes
to the run instead of relying on "it passed" text.

Codebase fit: partial. Lobrecs Agent is an Electron app with terminal and
workspace surfaces, but no browser/computer-use module.

Implementation sketch:

- Start with local web verification only: URL, viewport, screenshot artifact,
  console errors, network failures, and optional Playwright command recipe.
- Attach evidence to `RunAuditRecord`.
- Later integrate browser/computer-use providers as explicit plugins, not
  always-on capabilities.

Vertical placement:

- `src/shared/contracts/quality.ts` or `runs.ts`
- `src/main/modules/quality/infrastructure`
- `src/renderer/modules/workspace/components/artifacts`

Size: medium for local web evidence; large with desktop computer use.

Risk: privacy and permissions. Screenshots and browser state can contain
sensitive data; require user-triggered capture and clear retention.

### J. Voice Prompting And Floating Threads

Status: new low-priority UX candidate.

User value: faster prompt capture and a detachable active thread can help when
validating UI flows in another app.

Codebase fit: medium for floating windows in Electron, low for voice unless a
local or provider-backed transcription path is added.

Implementation sketch:

- Floating thread first: create a secondary Electron window bound to the active
  thread/session, with composer and stream only.
- Voice later: hold-to-record in composer, transcribe, insert editable text,
  and never auto-send.

Vertical placement:

- `src/main/app` for window lifecycle.
- `src/preload` narrow API for pop-out thread messaging.
- `src/renderer/modules/workspace` for the detachable view.

Size: medium.

Risk: distraction and privacy. Keep voice opt-in and editable before send.

## Merged Priority

| Rank | Feature | Change vs first doc | Why |
| --- | --- | --- | --- |
| 1 | Finish Approval Mode Wiring | Same, now in-flight | Visible safety control must match actual runtime permissions. |
| 2 | Local Diff Review Agent | Same | Daily workflow value and strong fit with git/diff surfaces. |
| 3 | Context Explorer And Prompt Evidence | Up | Backend IPC already exists; trust/debug value is high. |
| 4 | Run Audit Timeline | Up | Runs and quality primitives exist; external signal strongly supports auditability. |
| 5 | Automation Triage Inbox And Scheduler | Same, sharper | Competitors now treat automation as a triage inbox, not just scheduled prompts. |
| 6 | Unified Command Palette | Reframed | Cmd+K already exists; next slice is broader commands/search. |
| 7 | Agent Doctor And Environment Readiness | Up as quick win | Existing system capabilities make an on-demand doctor feasible. |
| 8 | Memory Promotion Workflow | Same | Stronger with Windsurf/Amp durable-rule signal, but memory UI already exists. |
| 9 | MCP Server Manager | New | MCP is now broad enough that governance is a product feature. |
| 10 | PR Handoff Pack | Slightly down | Still useful, but local review/audit should come first. |
| 11 | Cost Guardrails | New/reframed | Dashboard exists; dispatch and automation budgets are the missing value. |
| 12 | Worktree Handoff And Snapshot Restore | New, later | Powerful but risky under current local-run production rule. |
| 13 | Browser And Visual Verification Evidence | New, later | Valuable for UI-heavy tasks after audit records exist. |
| 14 | Agent Templates And Role Marketplace | Down | Needs stable permission, review, and MCP foundations first. |
| 15 | Voice Prompting And Floating Threads | New, low | Useful polish, not a core reliability primitive. |

## Suggested Next Implementation Slice

Feature: Context Explorer And Prompt Evidence.

Why this over automation first:

- It is smaller than the scheduler.
- Existing context IPC already exists.
- It improves trust in every agent run.
- It pairs well with the nearly-complete approval-mode work without touching
  the same implementation files.

Slice:

1. Add a `context` main view/tab or right-panel mode for the active project.
2. Render `context:status` with indexed files/chunks and updated time.
3. Add a manual reindex button.
4. Add a query box calling `context:search`.
5. Render path, line range, score, and content preview for top snippets.
6. Add a session-level "Prompt evidence" activity later, after the explorer is
   useful on demand.

Acceptance criteria:

- Users can inspect current index status from the workspace.
- Users can reindex the active project without terminal commands.
- Users can run a search and see retrieved snippets with paths and line ranges.
- No renderer code reads the filesystem directly.
- Empty, loading, error, stale-index, and no-results states are visible.

## Notes For Future Investigations

- Do not re-rank "Cmd+K" as missing without checking
  `src/renderer/components/SearchPalette/index.tsx`.
- Do not treat "Agent Health Check" as greenfield; build on the system module.
- Do not treat automations as done just because CRUD exists; the missing product
  value is scheduled execution plus review triage.
- Treat worktrees as an explicit future mode, not an implicit default, unless
  the production-path execution rule changes.
- Keep all new features vertical: shared contract, main application service,
  infrastructure adapter when needed, IPC registration, preload API, and
  renderer workflow module.
