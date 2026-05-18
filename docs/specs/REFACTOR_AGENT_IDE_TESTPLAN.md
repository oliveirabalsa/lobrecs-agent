# REFACTOR_AGENT_IDE — Manual Test Plan (M8)

Run-through that a human can step through after pulling the M8 polish branch.
All checks are visual / interactive — there is no automated E2E suite for the
renderer yet. Tick each box before signing off.

Prereqs:

- `npm run rebuild:node` if better-sqlite3 reports a `NODE_MODULE_VERSION`
  mismatch.
- `npm run dev` to launch the Electron shell in development mode.
- At least one project added with the plus button so the sidebar has a row to
  expand.

## 1. Sidebar (R-2.x)

- [ ] macOS: traffic lights overlay the top zone without clipping the back /
      forward arrows or the logo.
- [ ] Non-macOS: the same zone collapses to a tight `pl-2` layout with no
      reserved gap.
- [ ] Clicking a project chevron toggles its thread list with a short
      rotation (≤120 ms). State persists across reloads via
      `localStorage:sidebarExpanded:<projectId>`.
- [ ] Newly-added projects appear after the create flow without a manual
      refresh.
- [ ] Right-clicking a project row shows the Rename / Delete context menu.
      Both actions hit the IPC, refresh the list, and clear selection on
      delete.
- [ ] Thread rows show their title; running / awaiting-approval threads
      show a `<Spinner>` instead of the relative timestamp.
- [ ] Switching `session:*` status (start, error, completion, approval)
      flips the spinner / timestamp live without a sidebar reload.
- [ ] Renaming or pinning a thread in any other surface pushes a
      `thread:updated` event and the sidebar reflects it without refresh.
- [ ] Expanding a project with >10 threads shows "Show more (N)". Clicking
      reveals the rest; clicking again collapses back to 10.

## 2. Workspace top bar (R-2.3)

- [ ] The title shows the active thread prompt (truncated to 80 chars) or
      falls back to the project name.
- [ ] The ellipsis menu exposes Rename / Fork / Delete when those handlers
      are wired. Delete prompts a `window.confirm`.
- [ ] The model chip reflects `activeSession.modelOverride` →
      `routingDecision.model` → `auto`.
- [ ] The diff toggle is disabled when no diffs are pending and active
      (highlighted) when the right panel is open in diff mode.
- [ ] The terminal toggle behaves identically for the terminal mode.

## 3. Run column / Message stream (R-3.x)

- [ ] User bubbles render right-aligned with the bubble background; assistant
      text is plain (no bubble) and left-aligned.
- [ ] `WorkingState` shows "Working for Xs" and ticks the elapsed counter
      while a session is `running` or `awaiting-approval`.
- [ ] Running >1 shell command collapses into a `RanCommandsPill`. Clicking
      it expands the inline `CommandPreview` list.
- [ ] An edit set surfaces as an `EditedFilesCard` with totals, a per-file
      list, an Undo button, and a Review button.
- [ ] Clicking Review (header or a row) opens the right panel in diff mode
      and focuses that file's tab in `<DiffViewer>`.
- [ ] Clicking a `FileChangeRow` chevron expands an inline diff preview with
      Approve / Reject / View full diff actions.
- [ ] Approval requests surface as both an inline pill and the bottom
      `ApprovalCallout`. Approve / Reject buttons clear the request.
- [ ] On `session-complete` the stream renders a `CompletionFooter` with
      the terminal status.

## 4. Composer (R-5.x)

- [ ] The textarea auto-resizes between 56 px and 240 px.
- [ ] `Cmd+Enter` (or `Ctrl+Enter`) submits even when the button is
      disabled by a non-empty attachment-only state.
- [ ] The attach button opens an image picker / file dialog, and the
      `<AttachmentStrip>` shows up to 8 thumbnails with hover-to-remove.
- [ ] Pasting an image from the clipboard adds it to the strip without
      submitting.
- [ ] The approval-mode chip cycles through manual / auto modes.
- [ ] The model chip opens a popover grouped by agent with the current
      selection highlighted. Selecting one updates the chip label.
- [ ] The send button shows the circle arrow while idle and switches to a
      stop square while a session is running.
- [ ] The status footer shows the model, the current context %, and the
      worktree branch when one is set.

## 5. Right panel

- [ ] The first time diffs land for a session, the panel auto-opens in diff
      mode.
- [ ] When all diffs clear while diff mode is selected, the panel falls back
      to terminal mode automatically.
- [ ] Panel open / mode preferences survive a reload (`localStorage` keys
      `workspace.rightPanelOpen` and `workspace.rightPanelMode`).
- [ ] The close (×) button has an `aria-label="Close panel"`.

## 6. Plan prompt modal (R-6.x)

- [ ] An `askPlanPrompt` event surfaces a centered Radix `<Dialog>` with the
      title, options 1-9, and (if allowed) a free-text input.
- [ ] Pressing `1`–`9` quick-selects the matching option.
- [ ] Arrow keys navigate the option list.
- [ ] `Enter` submits the selection; `Esc` dismisses without sending a
      decision.
- [ ] The dialog has a backdrop fade-in and content pop-in under 200 ms,
      and the entire animation is suppressed under
      `prefers-reduced-motion: reduce`.

## 7. Threads + sessions plumbing (R-7.x)

- [ ] `agent:dispatch` from the Composer auto-creates or links a thread —
      the new thread appears in the sidebar within ~1 frame.
- [ ] Selecting a thread restores its last session into the workspace
      column and remembers the choice via
      `localStorage:activeThread:<projectId>`.
- [ ] Cmd+T resets to a new chat for the current project.
- [ ] Cmd+W cancels and closes the active session / thread.

## 8. Accessibility (R-8.2)

- [ ] Tab order flows top-to-bottom through Sidebar → TopBar → MessageStream
      → Composer with no traps.
- [ ] Sidebar back / forward, project chevrons, project plus, panel close,
      composer attach, composer send all have `aria-label`s.
- [ ] The active thread row has `aria-current="page"`.
- [ ] Radix Dialog focus is trapped while the modal is open and restored
      on close.
- [ ] All animations respect `@media (prefers-reduced-motion: reduce)`.

## 9. Skipped / deferred

- Search palette (R-8.4) — intentionally deferred from M8. Open a follow-up
  PR for a Cmd+K palette that searches across threads, projects, and files.
- E2E renderer tests — not implemented; this manual checklist is the
  primary acceptance gate.

## Known issues

- Unit tests that depend on better-sqlite3 fail locally when the binary was
  compiled against a different `NODE_MODULE_VERSION` than the running
  Node.js. Resolve with `npm run rebuild:node`. These failures are
  environmental and unrelated to M8 changes.
