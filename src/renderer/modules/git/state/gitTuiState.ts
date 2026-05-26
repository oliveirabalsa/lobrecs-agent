import type {
  GitBranchEntry,
  GitCommandResult,
  GitCommitEntry,
  GitFileEntry,
  GitPendingChanges,
  GitRepositorySnapshot as SharedGitRepositorySnapshot,
  GitStashEntry,
  GitTuiPanelId,
} from '../../../../shared/contracts/git'

export type {
  GitBranchEntry,
  GitCommitEntry,
  GitFileEntry,
  GitStashEntry,
  GitTuiPanelId,
}

export const GIT_TUI_PANEL_ORDER: readonly GitTuiPanelId[] = [
  'status',
  'files',
  'branches',
  'commits',
  'stash',
]

export interface GitOperationState {
  status: 'idle' | 'running' | 'success' | 'error'
  message?: string
  stdout?: string
  stderr?: string
}

export interface GitRepositorySnapshot extends SharedGitRepositorySnapshot {
  pending?: GitPendingChanges
}

export interface GitTuiSelectionState {
  status: number
  files: number
  branches: number
  commits: number
  stash: number
}

export const INITIAL_GIT_TUI_SELECTION: GitTuiSelectionState = {
  status: 0,
  files: 0,
  branches: 0,
  commits: 0,
  stash: 0,
}

export type GitTuiKeyCommand =
  | { type: 'focus-panel'; panelId: GitTuiPanelId }
  | { type: 'focus-next-panel' }
  | { type: 'focus-prev-panel' }
  | { type: 'move-selection'; direction: 'up' | 'down' }
  | { type: 'open-detail' }
  | { type: 'toggle-primary' }
  | { type: 'refresh' }
  | { type: 'pull' }
  | { type: 'push' }
  | { type: 'stage-all' }
  | { type: 'commit' }
  | { type: 'unstage' }
  | { type: 'discard' }
  | { type: 'create-branch' }
  | { type: 'delete-item' }
  | { type: 'filter' }
  | { type: 'show-help' }
  | { type: 'show-palette' }
  | { type: 'ai-review' }
  | { type: 'scroll-diff'; direction: 'down' | 'up' }
  | { type: 'escape' }
  | { type: 'noop' }

export type GitTuiAction =
  | { type: 'refresh' }
  | { type: 'pull' }
  | { type: 'push' }
  | { type: 'stage-all' }
  | { type: 'unstage-all' }
  | { type: 'commit'; message: string }
  | { type: 'toggle-file-stage'; path?: string; staged?: boolean }
  | { type: 'unstage-file'; path?: string }
  | { type: 'discard-file'; path?: string }
  | { type: 'checkout-branch'; branchName?: string }
  | { type: 'delete-branch'; branchName?: string }
  | { type: 'create-branch'; branchName?: string }
  | { type: 'apply-stash'; stashId?: string }
  | { type: 'drop-stash'; stashId?: string }
  | { type: 'open-file-diff'; path?: string }
  | { type: 'open-commit-detail'; hash?: string }
  | { type: 'open-stash-detail'; stashId?: string }
  | { type: 'open-branch-detail'; branchName?: string }
  | { type: 'ai-review-diff' }
  | { type: 'ai-generate-commit' }
  | { type: 'none' }

export interface GitTuiSelectedItems {
  file?: GitFileEntry
  branch?: GitBranchEntry
  commit?: GitCommitEntry
  stash?: GitStashEntry
}

export interface GitTuiKeyEventLike {
  key: string
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

export function resolveNextGitPanel(
  current: GitTuiPanelId,
  direction: 'next' | 'previous',
): GitTuiPanelId {
  const currentIndex = GIT_TUI_PANEL_ORDER.indexOf(current)
  const offset = direction === 'next' ? 1 : -1
  const nextIndex =
    (currentIndex + offset + GIT_TUI_PANEL_ORDER.length) % GIT_TUI_PANEL_ORDER.length
  return GIT_TUI_PANEL_ORDER[nextIndex]
}

export function resolveGitTuiKeyCommand(event: GitTuiKeyEventLike): GitTuiKeyCommand {
  if (event.ctrlKey && event.key === 'd') return { type: 'scroll-diff', direction: 'down' }
  if (event.ctrlKey && event.key === 'u') return { type: 'scroll-diff', direction: 'up' }
  if (event.metaKey || event.ctrlKey || event.altKey) return { type: 'noop' }

  if (event.key === 'Tab') {
    return event.shiftKey ? { type: 'focus-prev-panel' } : { type: 'focus-next-panel' }
  }

  const panelByNumber: Record<string, GitTuiPanelId | undefined> = {
    '1': 'status',
    '2': 'files',
    '3': 'branches',
    '4': 'commits',
    '5': 'stash',
  }
  const panelId = panelByNumber[event.key]
  if (panelId) return { type: 'focus-panel', panelId }

  switch (event.key) {
    case 'ArrowUp':
    case 'k':
      return { type: 'move-selection', direction: 'up' }
    case 'ArrowDown':
    case 'j':
      return { type: 'move-selection', direction: 'down' }
    case 'ArrowLeft':
    case 'h':
      return { type: 'focus-prev-panel' }
    case 'ArrowRight':
    case 'l':
      return { type: 'focus-next-panel' }
    case 'Enter':
      return { type: 'open-detail' }
    case ' ':
      return { type: 'toggle-primary' }
    case 'R':
      return { type: 'refresh' }
    case 'p':
      return { type: 'pull' }
    case 'P':
      return { type: 'push' }
    case 'a':
      return { type: 'stage-all' }
    case 'c':
      return { type: 'commit' }
    case 'u':
      return { type: 'unstage' }
    case 'd':
      return { type: 'discard' }
    case 'n':
      return { type: 'create-branch' }
    case 'D':
      return { type: 'delete-item' }
    case '/':
      return { type: 'filter' }
    case '?':
      return { type: 'show-help' }
    case ':':
      return { type: 'show-palette' }
    case 'A':
      return { type: 'ai-review' }
    case 'Escape':
      return { type: 'escape' }
    default:
      return { type: 'noop' }
  }
}

export function clampSelectionIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) return 0
  return Math.min(Math.max(index, 0), itemCount - 1)
}

export function resolveSelectionIndex(
  currentIndex: number,
  itemCount: number,
  direction: 'up' | 'down',
): number {
  if (itemCount <= 0) return 0
  const delta = direction === 'up' ? -1 : 1
  return (currentIndex + delta + itemCount) % itemCount
}

export function getPanelItemCount(
  panelId: GitTuiPanelId,
  snapshot: GitRepositorySnapshot | null,
): number {
  if (!snapshot) return 0
  if (panelId === 'status') return 1
  return snapshot[panelId].length
}

export function getSelectedGitTuiItems(
  snapshot: GitRepositorySnapshot | null,
  selection: GitTuiSelectionState,
): GitTuiSelectedItems {
  if (!snapshot) return {}
  return {
    file: snapshot.files[selection.files],
    branch: snapshot.branches[selection.branches],
    commit: snapshot.commits[selection.commits],
    stash: snapshot.stash[selection.stash],
  }
}

export function resolveGitTuiActionForCommand(
  command: GitTuiKeyCommand,
  activePanel: GitTuiPanelId,
  selected: GitTuiSelectedItems,
): GitTuiAction {
  switch (command.type) {
    case 'refresh':
      return { type: 'refresh' }
    case 'pull':
      return { type: 'pull' }
    case 'push':
      return { type: 'push' }
    case 'stage-all':
      return { type: 'stage-all' }
    case 'unstage':
      return activePanel === 'files' && selected.file?.staged
        ? { type: 'unstage-file', path: selected.file.path }
        : { type: 'none' }
    case 'discard':
      return activePanel === 'files'
        ? { type: 'discard-file', path: selected.file?.path }
        : { type: 'none' }
    case 'create-branch':
      return activePanel === 'branches' ? { type: 'create-branch' } : { type: 'none' }
    case 'delete-item':
      if (activePanel === 'branches') {
        return { type: 'delete-branch', branchName: selected.branch?.name }
      }
      if (activePanel === 'stash') return { type: 'drop-stash', stashId: selected.stash?.id }
      return { type: 'none' }
    case 'toggle-primary':
      if (activePanel === 'files') {
        return {
          type: 'toggle-file-stage',
          path: selected.file?.path,
          staged: selected.file?.staged,
        }
      }
      if (activePanel === 'branches') {
        return { type: 'checkout-branch', branchName: selected.branch?.name }
      }
      if (activePanel === 'stash') return { type: 'apply-stash', stashId: selected.stash?.id }
      return { type: 'none' }
    case 'open-detail':
      if (activePanel === 'files') return { type: 'open-file-diff', path: selected.file?.path }
      if (activePanel === 'branches') {
        return { type: 'open-branch-detail', branchName: selected.branch?.name }
      }
      if (activePanel === 'commits') {
        return { type: 'open-commit-detail', hash: selected.commit?.hash }
      }
      if (activePanel === 'stash') return { type: 'open-stash-detail', stashId: selected.stash?.id }
      return { type: 'none' }
    case 'ai-review':
      return { type: 'ai-review-diff' }
    default:
      return { type: 'none' }
  }
}

export function gitCommandResultToOperation(
  result: GitCommandResult,
  message: string,
): GitOperationState {
  return {
    status: result.exitCode === 0 ? 'success' : 'error',
    message,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}
