import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project } from '../../../../shared/types'
import { GitBranchesPanel } from './GitBranchesPanel'
import { GitCommandBar } from './GitCommandBar'
import { GitCommandPalette } from './GitCommandPalette'
import { GitCommitModal } from './GitCommitModal'
import { GitCommitsPanel } from './GitCommitsPanel'
import { GitFilesPanel } from './GitFilesPanel'
import { GitKeybindingsOverlay } from './GitKeybindingsOverlay'
import { GitMainPanel } from './GitMainPanel'
import { GitStashPanel } from './GitStashPanel'
import { GitStatusPanel } from './GitStatusPanel'
import { useGitTuiData } from '../hooks/useGitTuiData'
import { useGitTuiKeyboard } from '../hooks/useGitTuiKeyboard'
import {
  GIT_TUI_PANEL_ORDER,
  INITIAL_GIT_TUI_SELECTION,
  clampSelectionIndex,
  getPanelItemCount,
  getSelectedGitTuiItems,
  resolveGitTuiActionForCommand,
  resolveNextGitPanel,
  resolveSelectionIndex,
  type GitRepositorySnapshot,
  type GitTuiAction,
  type GitTuiKeyCommand,
  type GitTuiPanelId,
  type GitTuiSelectionState,
} from '../state/gitTuiState'

interface GitTuiPanelProps {
  project: Project | null
}

export function GitTuiPanel({ project }: GitTuiPanelProps) {
  const { snapshot, loading, error, operation, detail, refresh, runAction, generateCommitMessage } =
    useGitTuiData(project)
  const [activePanel, setActivePanel] = useState<GitTuiPanelId>('files')
  const [selection, setSelection] =
    useState<GitTuiSelectionState>(INITIAL_GIT_TUI_SELECTION)
  const [helpOpen, setHelpOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [commitOpen, setCommitOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filter, setFilter] = useState('')

  const filteredSnapshot = useMemo(
    () => filterSnapshot(snapshot, filter),
    [snapshot, filter],
  )

  useEffect(() => {
    setSelection((current) => ({
      status: 0,
      files: clampSelectionIndex(current.files, filteredSnapshot?.files.length ?? 0),
      branches: clampSelectionIndex(current.branches, filteredSnapshot?.branches.length ?? 0),
      commits: clampSelectionIndex(current.commits, filteredSnapshot?.commits.length ?? 0),
      stash: clampSelectionIndex(current.stash, filteredSnapshot?.stash.length ?? 0),
    }))
  }, [filteredSnapshot])

  const dispatchAction = useCallback(
    async (action: GitTuiAction) => {
      if (requiresConfirmation(action) && !window.confirm(confirmMessage(action))) return
      await runAction(action)
    },
    [runAction],
  )

  const handleCommand = useCallback(
    (command: GitTuiKeyCommand) => {
      if (command.type === 'show-help') {
        setHelpOpen(true)
        return
      }
      if (command.type === 'show-palette') {
        setPaletteOpen(true)
        return
      }
      if (command.type === 'commit') {
        setCommitOpen(true)
        return
      }
      if (command.type === 'filter') {
        setFilterOpen(true)
        return
      }
      if (command.type === 'escape') {
        setHelpOpen(false)
        setPaletteOpen(false)
        setCommitOpen(false)
        setFilterOpen(false)
        return
      }
      if (command.type === 'focus-panel') {
        setActivePanel(command.panelId)
        return
      }
      if (command.type === 'focus-next-panel' || command.type === 'focus-prev-panel') {
        setActivePanel((current) =>
          resolveNextGitPanel(current, command.type === 'focus-next-panel' ? 'next' : 'previous'),
        )
        return
      }
      if (command.type === 'move-selection') {
        setSelection((current) => ({
          ...current,
          [activePanel]: resolveSelectionIndex(
            current[activePanel],
            getPanelItemCount(activePanel, filteredSnapshot),
            command.direction,
          ),
        }))
        return
      }

      if (command.type === 'stage-all') {
        const files = filteredSnapshot?.files ?? []
        const allStaged = files.length > 0 && files.every((f) => f.staged)
        void dispatchAction({ type: allStaged ? 'unstage-all' : 'stage-all' })
        return
      }

      if (command.type === 'scroll-diff') {
        const el = document.querySelector('[data-scroll-target="git-diff"]')
        if (el) {
          const delta = Math.floor(el.clientHeight / 2)
          el.scrollBy({ top: command.direction === 'down' ? delta : -delta })
        }
        return
      }

      if (command.type === 'ai-review') {
        void dispatchAction({ type: 'ai-review-diff' })
        return
      }

      const action = resolveGitTuiActionForCommand(
        command,
        activePanel,
        getSelectedGitTuiItems(filteredSnapshot, selection),
      )
      void dispatchAction(action)
    },
    [activePanel, dispatchAction, filteredSnapshot, selection],
  )

  useGitTuiKeyboard({
    enabled: !helpOpen && !paletteOpen && !commitOpen,
    onCommand: handleCommand,
  })

  const handleSelectIndex = useCallback(
    (panelId: GitTuiPanelId, index: number) => {
      setActivePanel(panelId)
      setSelection((current) => ({ ...current, [panelId]: index }))
    },
    [],
  )

  if (!project) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="max-w-sm border border-dashed border-hairline px-5 py-6 text-center font-mono">
          <div className="text-[14px] font-semibold text-primary">GIT</div>
          <p className="mt-2 text-[12px] leading-5 text-muted">
            Select a repository to open the native keyboard-first git interface.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="git-tui-panel"
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#080d12] text-primary"
    >
      <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-hairline bg-black/20 px-3 font-mono">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-[13px] font-semibold tracking-normal text-primary">GIT</span>
          <span className="min-w-0 truncate text-[11px] text-muted">{project.name}</span>
          <span className="hidden truncate text-[11px] text-muted sm:inline">
            {project.repoPath}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted">
          <span>h/l panels</span>
          <span>? help</span>
        </div>
      </header>

      {filterOpen ? (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-hairline px-3 font-mono text-[12px]">
          <span className="text-accent-primary">/</span>
          <input
            autoFocus
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Enter') setFilterOpen(false)
            }}
            className="min-w-0 flex-1 bg-transparent text-primary outline-none placeholder:text-muted"
            placeholder={`filter ${activePanel}`}
          />
          {filter ? (
            <button
              type="button"
              onClick={() => setFilter('')}
              className="text-muted hover:text-primary"
            >
              clear
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,400px)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-1.5 p-1.5">
        <div className="flex min-h-0 flex-col gap-px overflow-hidden">
          <GitStatusPanel
            snapshot={filteredSnapshot}
            active={activePanel === 'status'}
            onFocus={setActivePanel}
          />
          <GitFilesPanel
            files={filteredSnapshot?.files ?? []}
            active={activePanel === 'files'}
            selectedIndex={selection.files}
            fallbackChangeCount={filteredSnapshot?.pending?.fileCount}
            onFocus={setActivePanel}
            onSelectIndex={(index) => handleSelectIndex('files', index)}
            onToggleStage={(file) =>
              void dispatchAction({
                type: 'toggle-file-stage',
                path: file.path,
                staged: file.staged,
              })
            }
          />
          <GitBranchesPanel
            branches={filteredSnapshot?.branches ?? []}
            active={activePanel === 'branches'}
            selectedIndex={selection.branches}
            onFocus={setActivePanel}
            onSelectIndex={(index) => handleSelectIndex('branches', index)}
            onCheckout={(branch) =>
              void dispatchAction({ type: 'checkout-branch', branchName: branch.name })
            }
          />
          <GitCommitsPanel
            commits={filteredSnapshot?.commits ?? []}
            active={activePanel === 'commits'}
            selectedIndex={selection.commits}
            onFocus={setActivePanel}
            onSelectIndex={(index) => handleSelectIndex('commits', index)}
            onViewDetail={(commit) =>
              void dispatchAction({ type: 'open-commit-detail', hash: commit.hash })
            }
          />
          <GitStashPanel
            stash={filteredSnapshot?.stash ?? []}
            active={activePanel === 'stash'}
            selectedIndex={selection.stash}
            onFocus={setActivePanel}
            onSelectIndex={(index) => handleSelectIndex('stash', index)}
            onApply={(entry) =>
              void dispatchAction({ type: 'apply-stash', stashId: entry.id })
            }
          />
        </div>

        <GitMainPanel
          snapshot={filteredSnapshot}
          loading={loading}
          error={error}
          operation={operation}
          detail={detail}
          onRefresh={refresh}
        />
      </div>

      <GitCommandBar activePanel={activePanel} />
      <GitKeybindingsOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      <GitCommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onAction={(action) => void dispatchAction(action)}
      />
      <GitCommitModal
        open={commitOpen}
        onClose={() => setCommitOpen(false)}
        onCommit={(message) => void dispatchAction({ type: 'commit', message })}
        onGenerateAI={generateCommitMessage}
      />
    </div>
  )
}

function filterSnapshot(
  snapshot: GitRepositorySnapshot | null,
  filter: string,
): GitRepositorySnapshot | null {
  const query = filter.trim().toLowerCase()
  if (!snapshot || !query) return snapshot
  return {
    ...snapshot,
    files: snapshot.files.filter((file) => file.path.toLowerCase().includes(query)),
    branches: snapshot.branches.filter((branch) => branch.name.toLowerCase().includes(query)),
    commits: snapshot.commits.filter((commit) =>
      `${commit.shortHash} ${commit.summary}`.toLowerCase().includes(query),
    ),
    stash: snapshot.stash.filter((entry) =>
      `${entry.id} ${entry.message}`.toLowerCase().includes(query),
    ),
  }
}

function requiresConfirmation(action: GitTuiAction): boolean {
  return (
    action.type === 'discard-file' ||
    action.type === 'delete-branch' ||
    action.type === 'drop-stash'
  )
}

function confirmMessage(action: GitTuiAction): string {
  switch (action.type) {
    case 'discard-file':
      return `Discard local changes in ${action.path ?? 'the selected file'}?`
    case 'delete-branch':
      return `Delete branch ${action.branchName ?? 'selected branch'}?`
    case 'drop-stash':
      return `Drop stash ${action.stashId ?? 'selected stash'}?`
    default:
      return 'Run this git action?'
  }
}

export function panelIndex(panelId: GitTuiPanelId): number {
  return GIT_TUI_PANEL_ORDER.indexOf(panelId)
}
