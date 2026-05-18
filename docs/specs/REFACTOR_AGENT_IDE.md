# Refactor — Codex-style Agent IDE Shell

**Status**: Draft (spec only — implementation gated on review)
**Owner**: Leonardo
**Created**: 2026-05-17
**Visual target**: Codex App (primary) + Cursor App (secondary accents)
**Scope**: Full refactor — renderer shell + minimum main-process additions required for parity

---

## 1. Purpose & Principles

Refactor the existing `lobrecs-agent` Electron app so its shell, navigation, chat workspace, composer, and inline run artifacts match Codex App's UX, with select Cursor App accents (sectioned sidebar, context% indicator). The engine (agent adapters, router, swarm, sessions store) stays — this is mostly a re-skin of the renderer plus the minimum main-process surface needed to back new UX (threads, plan-prompt round-trip, per-thread state).

**Principles**

1. **Codex layout wins on disputes.** Where Codex and Cursor diverge, Codex's pattern is the default. Cursor's contributions are explicitly called out per task.
2. **Reshape, don't rewrite.** The renderer is dense (~3,690 lines in `components/`). We replace surface layout and visual artifacts but keep IPC contracts intact where possible. New IPC is additive.
3. **Threads are the data-model unlock.** Today sessions are flat per project. Codex shows multiple named threads under each project with persistent history. Milestone 6 introduces a real `Thread` entity; earlier milestones use a renderer-side adapter so visuals can ship before the schema migration.
4. **Spec-driven, swarm-friendly.** Each task is independently scoped (~5–15 lines of meaningful code) with explicit acceptance criteria and file targets, so it can be handed to a single agent without conversation context.

---

## 2. Visual Design Contract

This section is the canonical reference all UI tasks point to. Numbers and behaviors are normative.

### 2.1 Window chrome

| Aspect | Spec |
|---|---|
| Frame | Frameless, outer radius ~12px, full dark surface |
| Titlebar | None (native hidden). macOS uses `titleBarStyle: 'hiddenInset'` so traffic lights overlay the sidebar's top-left padding (12px from top, 12px from left) |
| Drag region | Sidebar top zone + main top bar are draggable; interactive controls inside use `-webkit-app-region: no-drag` |

### 2.2 Sidebar (Codex-primary)

| Aspect | Spec |
|---|---|
| Width | 260px fixed (collapsible to 0 via toggle) |
| Background | One step lighter than canvas — `#141416` on `#0E0E0F` canvas, no border |
| Top zone | ~44px tall: traffic lights → history arrows (←/→) → small app icon |
| Action rows | 32px tall, icon (16px) + label (13px); hover = subtle fill. Order: **New chat**, **Search**, **Plugins**, **Automations** |
| Section header | "Projects" — 11px, uppercase, muted, ~16px top padding |
| Project row | Folder icon + name; chevron rotates when expanded; collapsed rows are folder+name only |
| Thread row (expanded child) | 16px left indent; label left, **muted timestamp right** (`2h`, `4h`) when idle, **spinner right** when running; active = filled background pill |
| "Show less" | Toggle at end of expanded thread list to collapse to N items |
| Footer | **Settings** (cog) row at bottom |
| Cursor accent (optional) | Per-project context% chip in the footer; user/avatar card pulled from Cursor pattern |

### 2.3 Top bar

| Aspect | Spec |
|---|---|
| Height | 44px |
| Left | Thread title (15px, semibold) + `···` overflow menu |
| Right cluster (left→right) | ▶ play, **model selector** (text label + `^` chevron), 2 right-panel toggle icons, info `i` |
| Drag | Whole bar is drag region except button hitboxes |

### 2.4 Message stream

| Element | Spec |
|---|---|
| User message | Right-aligned bubble, ~12px radius, fill `#1F1F22`, max ~70% width. Attachments render as thumbnails *inside* the bubble, above text. |
| Assistant message | Left-aligned, **no bubble**, plain text on canvas. Supports inline `code`, **bold**, lists, fenced code blocks (darker monospace box, ~8px radius). |
| Working state | "Working for 2m 56s" — 12px muted, no icon. Live counter while session is running. |
| Worked summary | "Worked for 2m 56s" — collapsible group containing all steps of a single turn. |
| Context divider | Hairline rule with centered pill `⌬ Context automatically compacted`, muted. |

### 2.5 Inline artifacts

| Artifact | Spec |
|---|---|
| **Ran N commands pill** | Rounded chip, raised dark surface, leading terminal icon + label + trailing chevron. Click expands to show commands. |
| **Command preview** | Single-line, leading icon, monospace inline-code, ellipsis truncation. |
| **Edited N files card** | Full-width card. Header: file-edit icon + `Edited N files` + diff summary `+29 -1` (green); right side: `Undo ↻` link + `Review` pill button. File rows below: full path + per-file `+14 -0` + chevron. |
| **Callout** | Bordered box, yellow accent + ⚠ icon, rendered inline as a quoted message. |
| **Post-assistant actions** | Subtle icon-only row beneath final assistant message: copy / 👍 / 👎 / share. |

### 2.6 Composer

| Element | Spec |
|---|---|
| Container | Single rounded rectangle, ~12px radius, dark, full-width with margin |
| Placeholder | "Ask for follow-up changes" |
| Bottom-left | `+` attach button → status chip (e.g., `⊘ Full access` with orange icon + chevron) |
| Bottom-right | Spinner (when running) → model label `5.5 Extra High` + chevron → mic → **large black circular send/stop button** |

### 2.7 Footer indicators (Cursor accent)

A 22px-tall row *below* composer: `⊡ Local` (or worktree path) left, `○ 62% context` right. ~11px muted text.

### 2.8 Plan-prompt modal (Codex)

Bordered dark card, centered, ~480px wide. Title "Implement this plan?" (15px, semibold).
Numbered option rows:
1. Highlighted background + right-side `↑↓` keyboard hint
2. `Dismiss ESC` hint + blue pill `Submit ↵` button

Keyboard contract: digits 1–9 quick-select, ↑↓ navigate, ESC dismiss, ↵ submit.

### 2.9 Color & typography tokens

| Token | Value |
|---|---|
| `--bg-canvas` | `#0E0E0F` |
| `--bg-sidebar` | `#141416` |
| `--bg-bubble-user` | `#1F1F22` |
| `--bg-card` | `#17171A` |
| `--text-primary` | `rgba(255,255,255,0.92)` |
| `--text-secondary` | `rgba(255,255,255,0.58)` |
| `--text-muted` | `rgba(255,255,255,0.40)` |
| `--accent-add` | `#34D399` (green) |
| `--accent-del` | `#F87171` (red) |
| `--accent-warn` | `#F59E0B` (orange/amber) |
| `--accent-primary` | `#3B82F6` (blue) |
| `--radius-bubble` | `12px` |
| `--radius-card` | `8px` |
| `--radius-pill` | `9999px` |
| `font-ui` | system (SF Pro / Inter), 13–14px body, 15–16px titles, 11–12px micro |
| `font-mono` | SF Mono / JetBrains Mono — commands, code, file paths |

---

## 3. Current → Target Architecture Diff

### 3.1 Renderer shell

| | Current | Target |
|---|---|---|
| Layout | 3-pane: ActivityRail (12px) + ProjectSidebar (268px) + WorkspaceView + HistoryPanel (310px) | 2-pane: Sidebar (260px) + Workspace |
| History | Right-side `HistoryPanel` with filter tabs | Threads nested under projects in left sidebar |
| Active session | Tab bar above workspace | Thread row in sidebar (one workspace = one thread) |
| Tabs | `TabBar` (Cmd+T/W) | Removed — thread switching via sidebar |
| Composer | `<select>` for model in input box | Model chip with chevron popover at composer footer |
| Window chrome | Standard macOS titlebar | `hiddenInset` — traffic lights overlay sidebar |

### 3.2 Main process

| | Current | Target |
|---|---|---|
| Sessions | Flat `Session[]` per project | Sessions grouped under `Thread`; `Thread` belongs to `Project` |
| Plan prompt | None (no round-trip) | `agent:plan-prompt` event from main; `agent:plan-decision` IPC back |
| Approval | One-way `approval-request` event | Stays one-way; UI presents Codex-style modal |
| Thread IPC | None | `threads:list/get/create/rename/delete/pin` |
| Token tally | Per-session | Per-thread aggregate (sum of child sessions) |

### 3.3 What stays unchanged

- `AgentAdapter` interface and all three adapter implementations
- `ModelRouter`, `SwarmOrchestrator` core logic
- `DiffViewer` (Monaco) — re-skinned but not rewritten
- `TerminalPanel` (XTerm) — re-skinned but not rewritten
- All existing `src/shared/contracts/*.ts` types — additive only
- Tailwind v4 setup
- SQLite persistence layer for projects/sessions/specs/runs

---

## 4. Milestones

Ordered for incremental shippability. Each milestone is independently mergeable and leaves the app in a working state.

| # | Milestone | Goal | Approx tasks |
|---|---|---|---|
| 0 | Foundation | Theme tokens, primitives, window chrome | 6 |
| 1 | Sidebar shell | Codex sidebar layout + nav rows + project tree | 10 |
| 2 | Workspace shell | Top bar + 2-pane layout + remove HistoryPanel | 7 |
| 3 | Message stream | User/assistant message styling + working state + dividers | 8 |
| 4 | Inline artifacts | Ran N commands pill, Edited N files card, command pills, callouts | 9 |
| 5 | Composer | Rounded composer + model chip + attach + send + Cursor footer | 8 |
| 6 | Plan prompt + approval modals | Codex-style modal + keyboard contract + IPC round-trip | 6 |
| 7 | Threads data model | `Thread` entity in main, IPC, sidebar wiring | 9 |
| 8 | Polish & QA | Animations, accessibility, dark-only theme audit, regression sweep | 6 |

**Total**: ~69 tasks.

---

## 5. Tasks

Each task: `R-<milestone>.<n>` — Title — Goal — Files — Acceptance criteria — Dependencies.

### Milestone 0 — Foundation

#### R-0.1 — Define design tokens as CSS custom properties

**Goal**: Centralize all colors, radii, and typography tokens from §2.9 so components reference variables, not hex codes.

**Files**:
- Modify `src/renderer/main.css`

**Acceptance criteria**:
- All tokens from §2.9 declared on `:root` as CSS custom properties (`--bg-canvas`, etc.)
- Tailwind v4 `@theme` block maps tokens to Tailwind utility classes (e.g., `bg-canvas`, `text-secondary`)
- `:root` `color-scheme: dark` retained
- No hex literals introduced in any component file in this milestone

**Dependencies**: none

---

#### R-0.2 — Primitive: `<Button>` component

**Goal**: One bespoke button component covering the four variants used in the design: `primary` (blue pill), `ghost` (icon-only hover), `chip` (rounded fill with chevron), `circle` (large black send/stop).

**Files**:
- Create `src/renderer/components/ui/Button.tsx`
- Create `src/renderer/components/ui/index.ts` (barrel)

**Acceptance criteria**:
- Variants: `primary | ghost | chip | circle`
- Sizes: `sm | md | lg`
- Supports `leadingIcon`, `trailingIcon`, `loading` (spinner replaces leading icon)
- `disabled` state with reduced opacity + `cursor-not-allowed`
- Passes through `aria-label` for icon-only variants
- One Vitest file with smoke tests for each variant

**Dependencies**: R-0.1

---

#### R-0.3 — Primitive: `<Pill>`, `<Card>`, `<Divider>`, `<Spinner>`

**Goal**: Minimal additional primitives needed by inline artifacts.

**Files**:
- Add to `src/renderer/components/ui/Pill.tsx`, `Card.tsx`, `Divider.tsx`, `Spinner.tsx`
- Update barrel

**Acceptance criteria**:
- `Pill`: rounded chip with optional leading/trailing icon, color variants (`neutral | success | warn | danger | info`)
- `Card`: dark card with `--radius-card`, optional header slot, hover state opt-in
- `Divider`: hairline + optional centered pill label (used for "Context automatically compacted")
- `Spinner`: 12px and 16px sizes, uses `--text-secondary`

**Dependencies**: R-0.1

---

#### R-0.4 — Enable `hiddenInset` titlebar on macOS

**Goal**: Remove native titlebar so traffic lights overlay the sidebar.

**Files**:
- Modify `src/main/app/createWindow.ts`

**Acceptance criteria**:
- `titleBarStyle: 'hiddenInset'` on macOS, `trafficLightPosition: { x: 12, y: 12 }`
- No window-frame chrome visible on launch
- App icon still set; window still resizable
- Linux/Windows fall back to existing behavior (no regression)

**Dependencies**: none

---

#### R-0.5 — Drag-region CSS utilities

**Goal**: Provide `.drag` and `.no-drag` utility classes so child components can opt in/out of `-webkit-app-region`.

**Files**:
- Modify `src/renderer/main.css`

**Acceptance criteria**:
- `.drag { -webkit-app-region: drag; }`
- `.no-drag { -webkit-app-region: no-drag; }`
- Documented inline with a comment that buttons inside drag zones must use `.no-drag`

**Dependencies**: R-0.4

---

#### R-0.6 — Remove `ActivityRail` and prepare 2-pane shell scaffold

**Goal**: Strip the 12px ActivityRail and reduce `RendererApp` to a 2-pane layout shell. Sidebar still uses old `ProjectSidebar` for now (replaced in M1).

**Files**:
- Modify `src/renderer/app/RendererApp.tsx`
- Modify (or delete) `src/renderer/components/ActivityRail/*` if exists

**Acceptance criteria**:
- App boots with sidebar + workspace only
- `HistoryPanel` still renders for now (removed in M2)
- No layout breakage of existing chat flow

**Dependencies**: R-0.4, R-0.5

---

### Milestone 1 — Sidebar shell

#### R-1.1 — New `<Sidebar>` shell component

**Goal**: Create the Codex-shaped sidebar container with top zone, action list, projects section, footer.

**Files**:
- Create `src/renderer/components/Sidebar/index.tsx`
- Create `src/renderer/components/Sidebar/SidebarTopZone.tsx`
- Create `src/renderer/components/Sidebar/SidebarActions.tsx`
- Create `src/renderer/components/Sidebar/SidebarFooter.tsx`

**Acceptance criteria**:
- 260px fixed width, `bg-sidebar`, no right border
- Top zone is 44px and `.drag` (except interactive icons which are `.no-drag`)
- Footer pinned at bottom with `Settings` cog row
- Renders three optional slots: `actions`, `projects`, `footer`
- Replaces `ProjectSidebar` in `RendererApp.tsx`

**Dependencies**: R-0.2, R-0.3, R-0.6

---

#### R-1.2 — Sidebar top zone: history arrows + app icon

**Goal**: Add window history arrows (back/forward) — they navigate workspace history (thread switches), not browser history. Add small app icon at the far right of the top zone.

**Files**:
- Modify `src/renderer/components/Sidebar/SidebarTopZone.tsx`
- Create `src/renderer/modules/workspace/hooks/useWorkspaceHistory.ts`

**Acceptance criteria**:
- ←/→ icons render; disabled state when no history
- Hook keeps an in-memory stack of thread IDs visited this session; supports back/forward
- App icon at right edge of top zone, 16px

**Dependencies**: R-1.1

---

#### R-1.3 — Action rows: New chat, Search, Plugins, Automations

**Goal**: Render the four primary actions as icon+label rows with hover state.

**Files**:
- Modify `src/renderer/components/Sidebar/SidebarActions.tsx`

**Acceptance criteria**:
- Four rows, 32px tall, 12px padding, 16px icon + 13px label
- Hover = `bg-white/5`
- `New chat` triggers existing dispatch flow with empty thread (uses existing `useWorkspaceController` action)
- `Search` opens a placeholder search palette (M8 will implement; for now `console.log`)
- `Plugins` and `Automations` link to existing routes/views; if absent, render disabled with tooltip

**Dependencies**: R-1.1

---

#### R-1.4 — `ProjectsSection` header

**Goal**: Render the "Projects" section header above the project list.

**Files**:
- Create `src/renderer/components/Sidebar/ProjectsSection.tsx`

**Acceptance criteria**:
- 11px uppercase muted text "Projects"
- 16px top padding from action list
- Trailing `+` icon button (12px) opens "Create project" flow (reuses existing IPC)

**Dependencies**: R-1.1

---

#### R-1.5 — `ProjectTreeItem` (collapsible row with folder icon)

**Goal**: Render each project as a folder row, expandable to show threads.

**Files**:
- Create `src/renderer/components/Sidebar/ProjectTreeItem.tsx`

**Acceptance criteria**:
- Folder icon + name + chevron (rotated when expanded)
- Click row toggles expansion; chevron click also toggles
- Expanded state persisted in `localStorage` keyed by project ID
- Right-click context menu: Rename, Delete (reuses existing handlers)

**Dependencies**: R-1.4

---

#### R-1.6 — `ThreadRow` (sidebar thread item)

**Goal**: Render a single thread row under an expanded project.

**Files**:
- Create `src/renderer/components/Sidebar/ThreadRow.tsx`

**Acceptance criteria**:
- 16px left indent, 32px tall
- Label (truncated with ellipsis) left, **timestamp** (e.g., `2h`, `4h`) right when idle
- **Spinner** right when associated session is running
- Active state = filled pill `bg-white/8`
- Click sets thread as active

**Dependencies**: R-1.1, R-1.5

---

#### R-1.7 — Relative-time formatter

**Goal**: Format timestamps as `2h`, `4h`, `3d`, `now` etc. for the sidebar.

**Files**:
- Create `src/renderer/lib/relativeTime.ts`

**Acceptance criteria**:
- Pure function: `formatRelative(date: Date | string | number, now = Date.now())`
- Output: `now`, `Nm`, `Nh`, `Nd`, `Nw`, otherwise date short (`Mar 4`)
- Vitest covering boundary cases (60s, 1h, 24h, 7d)

**Dependencies**: none

---

#### R-1.8 — "Show less" / "Show more" toggle for long thread lists

**Goal**: Collapse long thread lists to N=10 items with a "Show more" / "Show less" toggle.

**Files**:
- Modify `src/renderer/components/Sidebar/ProjectTreeItem.tsx`

**Acceptance criteria**:
- When a project has >10 threads expanded, show first 10 + "Show more (N)"
- Click expands all; toggles to "Show less"
- Threshold configurable via constant

**Dependencies**: R-1.6

---

#### R-1.9 — Wire sidebar to existing project & session IPC

**Goal**: Connect the new sidebar to `window.agentforge.projects.list()` and `window.agentforge.sessions.list(projectId)`. Until M7 lands, **a session = a thread** (1:1 mapping).

**Files**:
- Create `src/renderer/components/Sidebar/useProjectTree.ts`
- Modify `src/renderer/components/Sidebar/index.tsx`

**Acceptance criteria**:
- Hook fetches projects on mount, sessions per project on expand
- Sessions are surfaced as threads via a `Session → Thread` adapter function
- Status from session (`running`, etc.) drives spinner; `updatedAt` drives timestamp
- Live update: subscribe to `window.agentforge.on('agent:event:*')` and bump the matching thread's status

**Dependencies**: R-1.5, R-1.6, R-1.7

---

#### R-1.10 — Sidebar footer: Settings row

**Goal**: Render `Settings` row at the bottom of the sidebar.

**Files**:
- Modify `src/renderer/components/Sidebar/SidebarFooter.tsx`

**Acceptance criteria**:
- 32px row with cog icon + "Settings" label
- Click opens existing settings view/modal (if absent, route to placeholder)
- Pinned at sidebar bottom regardless of project list length (sidebar uses flex column with `mt-auto`)

**Dependencies**: R-1.1

---

### Milestone 2 — Workspace shell

#### R-2.1 — Remove `HistoryPanel` from `RendererApp`

**Goal**: Now that threads live in the sidebar, the right-side `HistoryPanel` is redundant. Remove it from the shell. Keep the file in tree for one milestone with a `@deprecated` JSDoc, then delete in M8.

**Files**:
- Modify `src/renderer/app/RendererApp.tsx`
- Add JSDoc to `src/renderer/components/HistoryPanel/index.tsx`

**Acceptance criteria**:
- HistoryPanel no longer mounted
- App width reclaimed by workspace
- Existing history filter logic (`all/running/review/done/error`) not lost — moved to a follow-up filter UI in sidebar search palette (M8 task)

**Dependencies**: R-1.9

---

#### R-2.2 — Remove `TabBar` (Cmd+T/W)

**Goal**: One workspace = one thread. Multi-tab switching now happens via sidebar.

**Files**:
- Modify `src/renderer/modules/workspace/views/WorkspaceView.tsx`

**Acceptance criteria**:
- `TabBar` component no longer rendered
- Cmd+T no longer opens new tab; remap to "new chat" (sidebar action)
- Cmd+W behavior preserved — closes current workspace/thread

**Dependencies**: R-2.1

---

#### R-2.3 — New `<WorkspaceTopBar>` component

**Goal**: 44px top bar above the message stream.

**Files**:
- Create `src/renderer/modules/workspace/components/WorkspaceTopBar.tsx`

**Acceptance criteria**:
- Left: thread title (15px semibold) + `···` overflow menu (rename, delete, fork)
- Right cluster: ▶ play (re-run last prompt), model selector chip, 2 right-panel toggle icons (diff/terminal), info `i`
- Bar uses `.drag`; controls use `.no-drag`
- Replaces existing `SessionHeader` slot

**Dependencies**: R-0.2

---

#### R-2.4 — Workspace 2-pane layout: stream + optional right panel

**Goal**: Re-layout workspace so message stream is primary; diff/terminal panels appear as a toggleable right panel (not bottom strip).

**Files**:
- Modify `src/renderer/modules/workspace/views/RunWorkspace.tsx`

**Acceptance criteria**:
- Stream is 100% width by default
- Toggle from top bar shows right panel (resizable, min 320px max 720px)
- Right panel hosts existing `DiffViewer` or `TerminalPanel` (mutually exclusive switch via tab in panel header)
- State of toggle persisted in `localStorage`

**Dependencies**: R-2.3

---

#### R-2.5 — Move composer out of `RunWorkspace` into a fixed `<Composer>` slot

**Goal**: Composer is a sibling of the stream, fixed to the bottom of the workspace pane, not nested deep in the run view.

**Files**:
- Modify `src/renderer/modules/workspace/views/WorkspaceView.tsx`
- Modify `src/renderer/modules/workspace/views/RunWorkspace.tsx`

**Acceptance criteria**:
- Workspace pane = column flex: `<WorkspaceTopBar />` + `<MessageStream />` (flex-1) + `<Composer />`
- Composer always visible at bottom regardless of stream scroll
- No double scrollbars

**Dependencies**: R-2.3, R-2.4

---

#### R-2.6 — Empty state for workspace with no active thread

**Goal**: Show a friendly empty state when no thread is selected (matches Codex's empty workspace).

**Files**:
- Create `src/renderer/modules/workspace/components/WorkspaceEmpty.tsx`

**Acceptance criteria**:
- Centered, muted text "Start a new chat or pick a thread"
- Composer still visible and functional (creates new thread on submit)

**Dependencies**: R-2.5

---

#### R-2.7 — Persist active thread per project

**Goal**: When user switches projects then comes back, the previously open thread is restored.

**Files**:
- Modify `src/renderer/modules/workspace/hooks/useWorkspaceController.ts`

**Acceptance criteria**:
- `localStorage` keyed by `activeThread:<projectId>`
- Restored on project switch
- New chat sets active thread to the new session ID

**Dependencies**: R-2.5

---

### Milestone 3 — Message stream

#### R-3.1 — `<MessageStream>` container

**Goal**: Replace the existing `ActivityTimeline` with a Codex-shaped stream. Initial cut maps the existing `AgentActivity` types onto new visuals.

**Files**:
- Create `src/renderer/modules/workspace/components/MessageStream.tsx`
- Move `ActivityTimeline.tsx` content out — split into typed renderers (next tasks)

**Acceptance criteria**:
- Vertical flex column, max-width 820px centered
- Auto-scroll to bottom on new event unless user has scrolled up (sticky-scroll behavior)
- Compaction divider visible mid-stream

**Dependencies**: R-2.5

---

#### R-3.2 — `<UserMessage>` (bubble)

**Goal**: Right-aligned user message bubble.

**Files**:
- Create `src/renderer/modules/workspace/components/UserMessage.tsx`

**Acceptance criteria**:
- Bubble: `bg-bubble-user`, `radius-bubble`, max 70% width, right-aligned
- Renders attachments (image thumbnails) above text
- Renders Markdown body (use existing markdown lib if present, else `react-markdown`)

**Dependencies**: R-3.1

---

#### R-3.3 — `<AssistantMessage>` (no bubble)

**Goal**: Left-aligned assistant message — text on canvas, no bubble.

**Files**:
- Create `src/renderer/modules/workspace/components/AssistantMessage.tsx`

**Acceptance criteria**:
- Renders Markdown with these styles: inline `code` (monospace, slight bg), **bold**, ordered/unordered lists, fenced code blocks (`Card` with mono font)
- Trailing action row (copy / 👍 / 👎 / share) — appears only on final assistant message in a turn
- Action handlers wired to existing IPC where available (feedback IPC); copy uses `navigator.clipboard`

**Dependencies**: R-3.1, R-0.3

---

#### R-3.4 — `<WorkingState>` (live timer)

**Goal**: "Working for 2m 56s" muted text that updates every second while session is running.

**Files**:
- Create `src/renderer/modules/workspace/components/WorkingState.tsx`

**Acceptance criteria**:
- Subscribes to session start time from `useSessionEvents`
- Updates every 1000ms while status is `running`
- Switches to "Worked for Xm Ys" on completion, becomes click-target to collapse the turn

**Dependencies**: R-3.1

---

#### R-3.5 — `<ContextDivider>` ("Context automatically compacted")

**Goal**: Render the compaction divider as a hairline rule with centered pill label.

**Files**:
- Use `Divider` primitive from R-0.3

**Acceptance criteria**:
- Triggered when stream receives an event of type `'compaction'` (new event type — see R-3.6)
- If no such event exists yet, this task ships the renderer and R-3.6 adds the event source

**Dependencies**: R-0.3

---

#### R-3.6 — Add `'compaction'` to `AgentActivity` union (additive)

**Goal**: Add a new activity type so the renderer can show the compaction divider.

**Files**:
- Modify `src/shared/contracts/sessions.ts`
- Modify `src/main/session/activity.ts` to emit a `compaction` activity when a session's context is truncated
- Update `src/main/session/activity.test.ts`

**Acceptance criteria**:
- New variant: `{ kind: 'compaction', at: ISO8601 }`
- Emitted from existing compaction code path in `activity.ts`
- Renderer handles it via `ContextDivider`
- No breakage in existing activity tests

**Dependencies**: R-3.5

---

#### R-3.7 — Turn grouping

**Goal**: Group all activities between one user message and the next into a "turn" so they can be collapsed under a single `Worked for Xm Ys` summary.

**Files**:
- Modify `src/renderer/modules/workspace/components/MessageStream.tsx`
- Create `src/renderer/modules/workspace/lib/groupTurns.ts`

**Acceptance criteria**:
- Pure function `groupTurns(events: AgentEvent[]): Turn[]`
- Each `Turn` = `{ userMessage, activities[], assistantMessage?, totalMs, status }`
- `MessageStream` renders one collapsible group per turn
- Vitest covers: single turn, multi-turn, mid-turn approval, error mid-turn

**Dependencies**: R-3.4

---

#### R-3.8 — Migrate existing `ActivityTimeline` consumers

**Goal**: Replace old `ActivityTimeline` usage with `MessageStream`. Delete the old component.

**Files**:
- Modify `src/renderer/modules/workspace/views/RunWorkspace.tsx`
- Delete `src/renderer/modules/workspace/components/ActivityTimeline.tsx` (and tests)

**Acceptance criteria**:
- No regression in event rendering — all activity kinds covered
- Visual regression check (manual): one existing session replays correctly

**Dependencies**: R-3.7

---

### Milestone 4 — Inline artifacts

#### R-4.1 — `<RanCommandsPill>` (collapsible)

**Goal**: Replace inline tool-call/command activity rendering with a Codex pill that collapses N commands into a single chip.

**Files**:
- Create `src/renderer/modules/workspace/components/artifacts/RanCommandsPill.tsx`

**Acceptance criteria**:
- Pill shows count: `Ran 3 commands` with terminal icon + trailing chevron
- Click expands to show each command (monospace, one per line) and stdout snippet
- When session is in-progress, label becomes `Running N commands…` with spinner
- Aggregates consecutive `command` + `tool-call` + `tool-result` activities into one pill

**Dependencies**: R-3.7

---

#### R-4.2 — `<CommandPreview>` (single-line monospace)

**Goal**: For single-command activities (not in a batch), render an inline pill with monospace command preview.

**Files**:
- Create `src/renderer/modules/workspace/components/artifacts/CommandPreview.tsx`

**Acceptance criteria**:
- One-line, leading icon, monospace command, ellipsis on overflow
- Click expands to show full command + output
- Used when an isolated `command` activity appears outside a multi-command batch

**Dependencies**: R-3.7

---

#### R-4.3 — `<EditedFilesCard>` (replaces DiffSummaryCard)

**Goal**: New card matching Codex's "Edited N files" with `+N -M`, `Undo`, `Review`, expandable file rows.

**Files**:
- Create `src/renderer/modules/workspace/components/artifacts/EditedFilesCard.tsx`
- Mark `src/renderer/modules/workspace/components/DiffSummaryCard.tsx` as `@deprecated`

**Acceptance criteria**:
- Header: file-edit icon + `Edited N files` + `+29 -1` (green)
- Right side: `Undo ↻` text link + `Review` pill button (opens diff in right panel)
- File rows: full path (truncate-left) + per-file `+14 -0` + chevron
- Expanded file row shows mini-diff inline (use Monaco read-only inline diff)
- `Undo` calls existing `diff:reject` IPC; `Review` opens the right panel

**Dependencies**: R-2.4, R-3.7, R-0.3

---

#### R-4.4 — `<Callout>` (warning/info quoted block)

**Goal**: Bordered yellow callout for warnings (e.g., "middleware is deprecated").

**Files**:
- Create `src/renderer/modules/workspace/components/artifacts/Callout.tsx`

**Acceptance criteria**:
- Variants: `warn | info | danger`
- Border left accent (3px) + matching icon
- Renders Markdown children
- Triggered by Markdown parser when assistant text contains a blockquote starting with `> [!WARNING]`-style directive (GitHub-flavored)

**Dependencies**: R-3.3

---

#### R-4.5 — `<ApprovalRequest>` inline pill (pre-modal)

**Goal**: When an approval request arrives, render an inline pill in-stream with "Approve" / "Reject" buttons. The full modal arrives in M5.

**Files**:
- Create `src/renderer/modules/workspace/components/artifacts/ApprovalRequestPill.tsx`

**Acceptance criteria**:
- Card with: action label, risk badge, command (mono), `cwd`
- Buttons: `Approve` (primary), `Reject` (ghost)
- Calls existing `agent:approve` / `agent:reject` IPC
- Disappears once a decision is made

**Dependencies**: R-3.7

---

#### R-4.6 — `<CompletionFooter>` (token + cost summary)

**Goal**: When a turn completes, render a muted footer with token in/out and cost.

**Files**:
- Create `src/renderer/modules/workspace/components/artifacts/CompletionFooter.tsx`

**Acceptance criteria**:
- One-line muted text: `12k in · 3.2k out · $0.018 · 2m 56s`
- Appears at end of completed turn, above action row
- Hidden if values missing

**Dependencies**: R-3.7

---

#### R-4.7 — `<FileChangeRow>` (single-file change activity)

**Goal**: Render `file-change` activities as a single row chip (used when not aggregated into EditedFilesCard).

**Files**:
- Create `src/renderer/modules/workspace/components/artifacts/FileChangeRow.tsx`

**Acceptance criteria**:
- Icon by change type (`create` ⊕, `edit` ✎, `delete` ⊖)
- File path (truncate-left) + `+N -M`
- Click opens diff in right panel

**Dependencies**: R-3.7

---

#### R-4.8 — Aggregate `file-change` events into `EditedFilesCard`

**Goal**: When multiple `file-change` events arrive in a single turn, collapse them into one `EditedFilesCard`. Single change uses `FileChangeRow`.

**Files**:
- Modify `src/renderer/modules/workspace/components/MessageStream.tsx`
- Modify `src/renderer/modules/workspace/lib/groupTurns.ts`

**Acceptance criteria**:
- Threshold = 2 file changes → card; 1 → row
- Aggregation respects time window — events ≥ 30s apart split into separate cards

**Dependencies**: R-4.3, R-4.7

---

#### R-4.9 — Stream renderer dispatch table

**Goal**: A single dispatch function maps each `AgentActivity` kind → component. Avoids the giant switch from old `ActivityTimeline`.

**Files**:
- Create `src/renderer/modules/workspace/lib/activityRenderers.tsx`

**Acceptance criteria**:
- `renderActivity(activity): ReactNode`
- Covers all kinds in `AgentActivity` union
- Unknown kinds render as muted "Unknown activity: {kind}" + JSON
- Vitest snapshot for each kind

**Dependencies**: R-4.1 through R-4.8

---

### Milestone 5 — Composer

#### R-5.1 — `<Composer>` container

**Goal**: Replace `TaskInput` with a Codex-shaped composer: single rounded card, two-row footer.

**Files**:
- Create `src/renderer/modules/workspace/components/Composer/index.tsx`
- Mark `src/renderer/components/TaskInput/index.tsx` as `@deprecated`

**Acceptance criteria**:
- Rounded card, `radius-bubble`, dark, full-width with margin
- Textarea auto-resizes (min 56px, max 240px)
- Footer = two rows: left controls + right controls
- Cmd+Enter submits; ESC clears unsent draft

**Dependencies**: R-2.5

---

#### R-5.2 — Attach `+` button + image thumbnails

**Goal**: Reproduce existing image-paste behavior in the new composer.

**Files**:
- Create `src/renderer/modules/workspace/components/Composer/AttachButton.tsx`
- Create `src/renderer/modules/workspace/components/Composer/AttachmentStrip.tsx`

**Acceptance criteria**:
- `+` opens OS file picker for images
- Paste of image to textarea adds to attachment strip
- Thumbnails 48px, X button to remove, max 8
- Uses existing `system:save-image-attachment` IPC

**Dependencies**: R-5.1

---

#### R-5.3 — Approval-mode status chip (`⊘ Full access` etc.)

**Goal**: Status chip with chevron dropdown showing the agent's approval/sandbox posture.

**Files**:
- Create `src/renderer/modules/workspace/components/Composer/ApprovalModeChip.tsx`

**Acceptance criteria**:
- Variants reflect current mode: `Full access` (orange ⊘), `Auto-approve safe` (blue), `Manual approve` (default)
- Dropdown lets user switch mode; calls a new (or existing) IPC `agent:set-approval-mode`
- If IPC absent, ship the chip as visual-only with a TODO comment + mock state — M7 wires it

**Dependencies**: R-5.1, R-0.2

---

#### R-5.4 — Model selector chip (replaces `<select>`)

**Goal**: Chip with model label + chevron opening a popover for agent/model picking.

**Files**:
- Create `src/renderer/modules/workspace/components/Composer/ModelChip.tsx`
- Create `src/renderer/modules/workspace/components/Composer/ModelPopover.tsx`

**Acceptance criteria**:
- Chip text: `{agent} · {model} · {tier}` (e.g., `Claude · Opus 4.7 · Frontier`); short form on small width
- Popover groups options by agent, with tier badges, "Auto routing" option at top
- Selection updates composer state; router preview text updates
- Closes on outside-click + ESC

**Dependencies**: R-5.1

---

#### R-5.5 — Mic button (placeholder)

**Goal**: Render mic button. Functionality is out of scope for this refactor; render disabled with tooltip "Coming soon".

**Files**:
- Modify `src/renderer/modules/workspace/components/Composer/index.tsx`

**Acceptance criteria**:
- Visible, disabled, tooltip on hover
- Future-friendly: wire `onMicClick` prop with no-op default

**Dependencies**: R-5.1

---

#### R-5.6 — Send/Stop button (large black circle)

**Goal**: The signature Codex send/stop button — large circular, switches between play (idle) → stop (running).

**Files**:
- Create `src/renderer/modules/workspace/components/Composer/SendButton.tsx`

**Acceptance criteria**:
- 36px circle, black bg, white icon
- Idle: paper-plane / arrow-up icon
- Running: square stop icon; click cancels session via `agent:cancel`
- Disabled when empty draft and not running

**Dependencies**: R-5.1, R-0.2

---

#### R-5.7 — Composer footer status row (Cursor accent)

**Goal**: Tiny row below composer: `Local | worktree-path` left, `○ N% context` right.

**Files**:
- Create `src/renderer/modules/workspace/components/Composer/StatusFooter.tsx`

**Acceptance criteria**:
- 22px tall, 11px muted text
- Left shows `Local` if no worktree, `Worktree: <branch>` if running in worktree
- Right shows `○ N% context` derived from current session token count vs. model max
- Updates live as session progresses

**Dependencies**: R-5.1

---

#### R-5.8 — Composer router preview line

**Goal**: Below textarea, a one-line muted preview of the router's decision (when in Auto mode): `→ Claude · Opus 4.7 · score 0.82 · reason: complex multi-file refactor`.

**Files**:
- Modify `src/renderer/modules/workspace/components/Composer/index.tsx`

**Acceptance criteria**:
- Calls existing `router:preview` IPC, debounced 500ms on textarea change
- Hidden when manual model selected
- Hidden when textarea is empty

**Dependencies**: R-5.1, R-5.4

---

### Milestone 6 — Plan prompt + approval modals

#### R-6.1 — `<Modal>` primitive (Radix wrapper)

**Goal**: A reusable modal component matching Codex card style.

**Files**:
- Create `src/renderer/components/ui/Modal.tsx`

**Acceptance criteria**:
- Wraps `@radix-ui/react-dialog` (already a dep)
- Dark card, `radius-card`, max-width prop, centered
- Backdrop with low opacity (rgba(0,0,0,0.5)) and blur (`backdrop-filter: blur(4px)`)
- ESC closes; backdrop click closes
- Returns focus to trigger on close

**Dependencies**: R-0.3

---

#### R-6.2 — `<PlanPromptModal>` (Codex-style numbered options)

**Goal**: The "Implement this plan?" modal with numbered options + keyboard contract.

**Files**:
- Create `src/renderer/modules/workspace/components/modals/PlanPromptModal.tsx`

**Acceptance criteria**:
- Title + N option rows
- Keyboard: 1–9 quick-select, ↑↓ navigate, ENTER submit, ESC dismiss
- Selected row highlighted with right-side `↑↓` hint
- Unselected last row shows `Dismiss ESC` + blue `Submit ↵` pill
- `onDecision(optionId, freeText?)` callback
- The "No, and tell X what to do differently" option reveals an inline textarea before submit

**Dependencies**: R-6.1

---

#### R-6.3 — Add plan-prompt event type to contracts

**Goal**: Add the round-trip event types so main can ask renderer for a plan decision.

**Files**:
- Modify `src/shared/contracts/sessions.ts` (add `plan-prompt` event variant)
- Modify `src/shared/contracts/agents.ts` (add `agent:plan-decision` IPC shape)

**Acceptance criteria**:
- New event: `{ kind: 'plan-prompt', sessionId, title, options: [{id, label}], allowFreeText: boolean }`
- New IPC: `agent:plan-decision`, payload `{ sessionId, optionId, freeText? }`
- Both typed end-to-end (preload + main handler stub)

**Dependencies**: none

---

#### R-6.4 — Wire plan-prompt event into renderer

**Goal**: When a `plan-prompt` event lands, show the modal. On decision, dispatch IPC back to main.

**Files**:
- Modify `src/renderer/modules/workspace/hooks/useSessionEvents.ts`
- Modify `src/renderer/modules/workspace/views/RunWorkspace.tsx`

**Acceptance criteria**:
- Hook surfaces `pendingPlanPrompt` to the view
- View renders `PlanPromptModal` when present
- On submit, calls `window.agentforge.agent.planDecision(...)`
- Modal closes after decision

**Dependencies**: R-6.2, R-6.3

---

#### R-6.5 — Reskin `ApprovalRequest` as modal variant (optional escalation)

**Goal**: For high-risk approvals (`risk: 'high'`), present a Codex-style modal instead of the inline pill from R-4.5.

**Files**:
- Modify `src/renderer/modules/workspace/views/RunWorkspace.tsx`
- Reuse `Modal` primitive from R-6.1

**Acceptance criteria**:
- If `approvalRequest.risk === 'high'`, show modal
- Else, use inline pill
- Modal shows command, cwd, risk explanation; same Approve/Reject IPC

**Dependencies**: R-6.1, R-4.5

---

#### R-6.6 — Main-process stub: emit a plan-prompt for swarm spec confirmation

**Goal**: To exercise the new round-trip, wire `SwarmOrchestrator` to emit a `plan-prompt` before kicking off a swarm — using it as the first real use-case.

**Files**:
- Modify `src/main/swarm/SwarmOrchestrator.ts`

**Acceptance criteria**:
- Before spawning agents, emit `plan-prompt` with options `[Yes, implement | No, tell me what to change]`
- Wait for `agent:plan-decision` (with a 5-min timeout that cancels swarm)
- If `Yes`, proceed; if `No` with freeText, treat freeText as new spec context and re-route
- Integration test in `SwarmOrchestrator.test.ts` covers both paths

**Dependencies**: R-6.3

---

### Milestone 7 — Threads data model

This milestone is the largest change but unblocks the "many threads per project" sidebar UX. Until M7, threads = sessions 1:1.

#### R-7.1 — `Thread` contract

**Goal**: Add the `Thread` type to shared contracts.

**Files**:
- Create `src/shared/contracts/threads.ts`

**Acceptance criteria**:
- `Thread = { id, projectId, title, createdAt, updatedAt, pinned: boolean, lastSessionId?: string, archivedAt?: string }`
- Export from `src/shared/contracts/index.ts`

**Dependencies**: none

---

#### R-7.2 — `threadsStore` (SQLite)

**Goal**: SQLite-backed CRUD for threads.

**Files**:
- Create `src/main/store/threads.ts`
- Create `src/main/store/threads.test.ts`
- Update `src/main/store/index.ts` to run migration

**Acceptance criteria**:
- Table `threads (id TEXT PK, project_id TEXT FK, title TEXT, created_at TEXT, updated_at TEXT, pinned INTEGER, last_session_id TEXT, archived_at TEXT)`
- CRUD: `list(projectId, {includeArchived})`, `get(id)`, `create(data)`, `update(id, partial)`, `archive(id)`, `pin(id, value)`
- Migration auto-creates table on first run
- Tests cover happy path + archived filter

**Dependencies**: R-7.1

---

#### R-7.3 — Backfill: every existing session becomes its own thread

**Goal**: One-time migration so existing sessions appear as single-session threads in the new UI.

**Files**:
- Modify `src/main/store/threads.ts` (add `backfillFromSessions()`)
- Invoke from `src/main/app/bootstrap.ts`

**Acceptance criteria**:
- On startup, for any session with no `thread_id`, create a thread (title = first 60 chars of prompt) and link the session
- Add nullable `thread_id` column to `sessions` table
- Migration is idempotent (skips already-linked sessions)

**Dependencies**: R-7.2

---

#### R-7.4 — IPC: `threads:list/get/create/rename/delete/pin/archive`

**Goal**: New IPC handlers for thread operations.

**Files**:
- Create `src/main/modules/threads/ipc/registerThreadHandlers.ts`
- Modify `src/main/ipc/index.ts` to register them

**Acceptance criteria**:
- All 7 channels registered with typed contracts
- Errors surface as Electron `throw` (renderer catches)

**Dependencies**: R-7.2

---

#### R-7.5 — Preload: `window.agentforge.threads.*`

**Goal**: Bridge the new IPC into the renderer.

**Files**:
- Create `src/preload/api/threads.ts`
- Modify `src/preload/api/index.ts`
- Update `src/preload/index.test.ts`

**Acceptance criteria**:
- `window.agentforge.threads.list/get/create/rename/delete/pin/archive` all callable
- Preload tests cover each

**Dependencies**: R-7.4

---

#### R-7.6 — Auto-create thread on `agent:dispatch` if none provided

**Goal**: When `agent:dispatch` is called without a `threadId`, create a new thread and link the session to it. When called with a `threadId`, link to existing.

**Files**:
- Modify `src/shared/contracts/agents.ts` (add optional `threadId` to `AgentDispatchParams`)
- Modify `src/main/modules/agents/ipc/registerAgentHandlers.ts`
- Modify `src/main/session/SessionManager.ts`

**Acceptance criteria**:
- If no `threadId`: create thread (title from prompt first 60 chars), link session
- If `threadId` provided: validate exists, link
- New session updates thread's `updated_at` and `last_session_id`

**Dependencies**: R-7.3

---

#### R-7.7 — Sidebar adapter: replace `useProjectTree` to use threads not sessions

**Goal**: Switch the sidebar from "sessions = threads" to "threads from `threads:list`".

**Files**:
- Modify `src/renderer/components/Sidebar/useProjectTree.ts`

**Acceptance criteria**:
- Project expansion fetches `window.agentforge.threads.list(projectId)`
- Thread status derived from the thread's `lastSessionId` (look up session status)
- Live updates: subscribe to thread:updated event (new — see R-7.8)

**Dependencies**: R-7.6, R-1.9

---

#### R-7.8 — Broadcast `thread:updated` events

**Goal**: When thread metadata changes (rename, pin, status via linked session), broadcast to renderer for live sidebar updates.

**Files**:
- Modify `src/main/modules/threads/ipc/registerThreadHandlers.ts`
- Modify `src/main/session/SessionManager.ts`

**Acceptance criteria**:
- `webContents.send('thread:updated', { threadId, thread })`
- Preload exposes `window.agentforge.on('thread:updated', cb)`

**Dependencies**: R-7.4, R-7.5

---

#### R-7.9 — Thread overflow menu actions (rename / pin / archive)

**Goal**: Wire the `···` overflow on thread rows + workspace top bar to the new IPC.

**Files**:
- Modify `src/renderer/components/Sidebar/ThreadRow.tsx`
- Modify `src/renderer/modules/workspace/components/WorkspaceTopBar.tsx`

**Acceptance criteria**:
- Rename: inline editable label, ENTER saves
- Pin: pinned threads sort to top of project, with pin icon
- Archive: archived threads hidden unless "Show archived" toggle in project section

**Dependencies**: R-7.5, R-7.7

---

### Milestone 8 — Polish & QA

#### R-8.1 — Animation pass

**Goal**: Add subtle transitions where Codex has them.

**Files**:
- Various component files

**Acceptance criteria**:
- Sidebar collapse: 150ms ease-out
- Modal enter: 120ms ease-out
- Hover states: 80ms
- No animations exceed 200ms
- `prefers-reduced-motion` honored everywhere

**Dependencies**: M0–M7

---

#### R-8.2 — Accessibility audit

**Goal**: Keyboard navigation + screen-reader labels across new shell.

**Files**:
- Various

**Acceptance criteria**:
- Tab order: sidebar → top bar → stream → composer
- All icon-only buttons have `aria-label`
- Active states announced (`aria-current="page"` for active thread)
- Modal traps focus (Radix already does this)
- Run `axe` against main views; document violations and fix or annotate

**Dependencies**: M0–M7

---

#### R-8.3 — Delete deprecated files

**Goal**: Remove `HistoryPanel`, `TaskInput`, `DiffSummaryCard`, `ActivityTimeline`, `TabBar`, `ActivityRail` (any still present) and their tests.

**Files**:
- Delete each
- Remove imports

**Acceptance criteria**:
- `git grep` finds no references
- Test suite still green

**Dependencies**: M0–M7

---

#### R-8.4 — Search palette

**Goal**: Implement the sidebar `Search` action — cross-project + cross-thread fuzzy search of messages.

**Files**:
- Create `src/renderer/components/SearchPalette/index.tsx`
- Add `threads:search` and `sessions:search` IPC

**Acceptance criteria**:
- Cmd+K opens palette
- Searches thread titles + message text
- Click result navigates to thread + scrolls to message
- Indexing strategy documented inline (initial: linear scan of recent N=200 threads; FTS5 future)

**Dependencies**: R-7.2

---

#### R-8.5 — Visual regression manual checklist

**Goal**: A test plan a human (or playwright agent) can follow to verify each screen matches the design.

**Files**:
- Create `docs/specs/REFACTOR_AGENT_IDE_TESTPLAN.md`

**Acceptance criteria**:
- Step-by-step checklist for each of: sidebar, top bar, stream, artifacts, composer, modals
- Reference screenshot per surface (filename + commit)
- Pass/fail boxes

**Dependencies**: M0–M7

---

#### R-8.6 — Update `AGENTS.md` and `README.md`

**Goal**: Reflect the new shell architecture and naming conventions.

**Files**:
- Modify `AGENTS.md`
- Modify `README.md`

**Acceptance criteria**:
- Architecture diagram updated
- Component map updated
- Note that this refactor was done as `R-*` tasks tracked in this spec

**Dependencies**: M0–M7

---

## 6. Verification Plan

| Layer | How verified |
|---|---|
| Types | `tsc --noEmit` (existing CI step) |
| Unit | `vitest run` per file added — coverage for new pure functions (`groupTurns`, `relativeTime`, dispatch table) |
| Component smoke | Vitest + `@testing-library/react` for `PlanPromptModal` keyboard contract, `Composer` send behavior, `Sidebar` expand/collapse |
| Integration | Existing `SessionManager` + new `threadsStore` tests + plan-prompt round-trip in `SwarmOrchestrator.test.ts` |
| Visual | Manual checklist (R-8.5). Optionally Playwright snapshots in a follow-up |
| Performance | Stream re-render budget: 50ms per 100 activities (measure with React DevTools in a stress session) |

---

## 7. Risks & Open Questions

1. **Thread backfill window** — On first launch after M7 lands, every existing session creates a thread. For users with thousands of sessions this is a one-time slow startup. **Mitigation**: run backfill in a background async task, surface threads progressively.

2. **Stream re-render cost** — Old `ActivityTimeline` already caps at 120 events. New `MessageStream` should keep that cap and use `React.memo` aggressively on artifacts. **Open**: do we need virtualization (`react-virtuoso`) for long sessions? Defer until measured.

3. **Plan-prompt round-trip timeout** — If user walks away from the modal, the swarm hangs. Default 5-min timeout is in R-6.6, but is that right? **Open question for review.**

4. **Approval-mode IPC missing today** — R-5.3 ships the chip with mock state. We need to decide if "Full access / Auto-approve / Manual" maps to existing adapter capabilities or requires a new contract field on `Session`. **Defer to M7 review.**

5. **Cursor "MiniMax-M2.7" labeling** — Cursor surfaces model names that don't exist in this app's roster. Use our own `agent · model · tier` triplet; do not mimic Cursor's exact labels.

6. **Existing `tasks/T-*.md`** — Don't conflict with these. All new tasks use `R-*` IDs. When all R-tasks land, archive the spec into `docs/architecture/`.

---

## 8. Out of Scope

- Light mode theme. App stays dark-only.
- Mobile or web shipping target. Electron desktop only.
- Voice input (mic button is a placeholder).
- True multi-window. Single window stays.
- Replacing Monaco / XTerm with anything else.
- Login / user-account / cloud-sync UI (Cursor's "Free Plan" badge is not adopted).
- Marketplace / Plugins functionality beyond a placeholder sidebar action.

---

## 9. Implementation Order (Recommended)

1. **M0** (Foundation) — must land first; everything depends on tokens + primitives + chrome.
2. **M1 + M2 in parallel** — sidebar and workspace shell are independent surfaces.
3. **M3 + M4 in parallel** — message stream and inline artifacts can be built side-by-side once M2 lands.
4. **M5** — composer; needs M2 layout slot.
5. **M6** — plan prompt + modals; needs M0 primitives, can land anytime after.
6. **M7** — threads; biggest data change, slot in once UI is settled to avoid double rework.
7. **M8** — polish, deletions, docs.

Swarm-friendly dispatching: tasks within the same milestone marked with no inter-dependency can run in parallel agents. Tasks across milestones must respect the milestone order above.

---

## 10. Definition of Done

- All `R-*` tasks marked complete with code merged.
- `vitest run` passes.
- `tsc --noEmit` passes.
- Manual checklist (R-8.5) signed off.
- One full end-to-end session recorded matching screenshot fidelity.
- No `@deprecated` files remain in `src/renderer/`.
