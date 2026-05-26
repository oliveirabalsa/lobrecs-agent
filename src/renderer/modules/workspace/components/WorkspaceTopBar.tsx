import { useEffect, useRef, useState } from 'react'
import type { EditorInfo } from '../../../../shared/types'
import { Pill } from '../../../components/ui'
import { OpenInEditorMenu } from './OpenInEditorMenu'
import { BranchDropdown } from './BranchDropdown'

export type RightPanelMode =
  | 'diff'
  | 'terminal'
  | 'swarm'
  | 'context'
  | 'reviews'
  | 'doctor'
  | 'evidence'

interface WorkspaceTopBarProps {
  title: string
  model?: string
  branchName?: string | null
  rightPanelOpen: boolean
  rightPanelMode: RightPanelMode
  hasDiff: boolean
  hasSwarmGraph: boolean
  hasContext: boolean
  hasReviews: boolean
  canRerun: boolean
  onRerun?: () => void | Promise<void>
  onToggleRightPanel: (mode: RightPanelMode) => void
  onRename?: (newTitle: string) => void
  onDelete?: () => void
  onFork?: () => void
  reserveTrafficLightInset?: boolean
  onOpenSidebar?: () => void
  /** Absolute repo path for the active project — enables the "Open in" menu. */
  repoPath?: string
  onOpenCliEditor?: (editor: EditorInfo) => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  projectId?: string
  onBranchesClick?: () => void
  onBranchChanged?: () => void
}

/**
 * 44px top bar. Drag region except interactive controls.
 *
 * Left: thread title (15px semibold) + `···` overflow menu.
 * Right cluster (no-drag): ▶ rerun, model chip, diff/terminal toggles, info.
 */
export function WorkspaceTopBar({
  title,
  model,
  branchName,
  rightPanelOpen,
  rightPanelMode,
  hasDiff,
  hasSwarmGraph,
  hasContext,
  hasReviews,
  canRerun,
  onRerun,
  onToggleRightPanel,
  onRename,
  onDelete,
  onFork,
  reserveTrafficLightInset = false,
  onOpenSidebar,
  repoPath,
  onOpenCliEditor,
  sidebarCollapsed = false,
  onToggleSidebar,
  projectId,
  onBranchesClick,
  onBranchChanged,
}: WorkspaceTopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(title)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const editRef = useRef<HTMLInputElement | null>(null)
  const [panelMenuOpen, setPanelMenuOpen] = useState(false)
  const panelMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setDraftTitle(title)
  }, [title])

  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(event: MouseEvent) {
      if (!menuRef.current) return
      if (!menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  useEffect(() => {
    if (editing) editRef.current?.focus()
  }, [editing])

  useEffect(() => {
    if (!panelMenuOpen) return
    function onDocClick(event: MouseEvent) {
      if (!panelMenuRef.current) return
      if (!panelMenuRef.current.contains(event.target as Node)) setPanelMenuOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPanelMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [panelMenuOpen])

  function commitRename() {
    const trimmed = draftTitle.trim()
    setEditing(false)
    if (!trimmed || trimmed === title) {
      setDraftTitle(title)
      return
    }
    onRename?.(trimmed)
  }

  const diffActive = rightPanelOpen && rightPanelMode === 'diff'
  const termActive = rightPanelOpen && rightPanelMode === 'terminal'
  const swarmActive = rightPanelOpen && rightPanelMode === 'swarm'
  const contextActive = rightPanelOpen && rightPanelMode === 'context'
  const reviewsActive = rightPanelOpen && rightPanelMode === 'reviews'
  const doctorActive = rightPanelOpen && rightPanelMode === 'doctor'
  const evidenceActive = rightPanelOpen && rightPanelMode === 'evidence'
  const branchLabel = branchName?.trim()
  const leftInsetClass = reserveTrafficLightInset
    ? (sidebarCollapsed ? 'pl-[70px]' : 'pl-[70px] md:pl-4')
    : 'pl-2 md:pl-4'

  return (
    <div
      className={`drag flex h-11 min-w-0 shrink-0 items-center border-b border-hairline bg-canvas ${leftInsetClass} pr-2`}
    >
      <div className="no-drag flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {onOpenSidebar ? (
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="Open sidebar"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-secondary transition-colors hover:bg-white/5 hover:text-primary md:hidden"
          >
            <MenuIcon />
          </button>
        ) : null}
        {onToggleSidebar ? (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            title={sidebarCollapsed ? 'Show sidebar (⌘B)' : 'Hide sidebar (⌘B)'}
            className="hidden md:flex h-7 w-7 shrink-0 items-center justify-center rounded text-secondary transition-colors hover:bg-white/5 hover:text-primary"
          >
            <SidebarToggleIcon collapsed={!!sidebarCollapsed} />
          </button>
        ) : null}
        {editing ? (
          <input
            ref={editRef}
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitRename()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setEditing(false)
                setDraftTitle(title)
              }
            }}
            className="h-7 min-w-0 flex-1 rounded-card border border-hairline bg-card px-2 text-[15px] font-semibold text-primary outline-none focus:border-accent-primary/60"
            aria-label="Rename thread"
          />
        ) : (
          <h1
            className="min-w-0 flex-1 truncate text-[15px] font-semibold text-primary"
            title={title}
          >
            {title}
          </h1>
        )}
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label="Thread options"
            className="flex h-7 w-7 items-center justify-center rounded text-muted transition-colors hover:bg-white/5 hover:text-primary"
          >
            <EllipsisIcon />
          </button>
          {menuOpen ? (
            <div className="absolute left-0 top-8 z-50 w-40 overflow-hidden rounded-card border border-hairline bg-card-raised py-1 shadow-xl shadow-black/40">
              {onRename ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    setEditing(true)
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-primary hover:bg-white/5"
                >
                  Rename
                </button>
              ) : null}
              {onFork ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    onFork()
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-primary hover:bg-white/5"
                >
                  Fork
                </button>
              ) : null}
              {onDelete ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    const confirmed = window.confirm('Delete this thread?')
                    if (confirmed) onDelete()
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-accent-del hover:bg-accent-del/10"
                >
                  Delete
                </button>
              ) : null}
              {!onRename && !onDelete && !onFork ? (
                <div className="px-3 py-1.5 text-xs text-muted">No actions available</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="no-drag flex shrink-0 items-center gap-1">
        <IconButton
          aria-label="Rerun last prompt"
          disabled={!canRerun || !onRerun}
          onClick={onRerun}
          className="hidden sm:flex"
        >
          <PlayIcon />
        </IconButton>

        <Pill
          tone="neutral"
          className="hidden max-w-[160px] sm:inline-flex lg:max-w-[200px]"
        >
          {model ? model : 'auto'}
        </Pill>

        {branchLabel && projectId ? (
          <BranchDropdown
            projectId={projectId}
            currentBranch={branchLabel}
            onBranchChanged={onBranchChanged}
            onBranchesClick={onBranchesClick}
          />
        ) : branchLabel ? (
          <Pill
            tone="info"
            leadingIcon={<BranchIcon />}
            className="max-w-[120px] sm:max-w-[220px] inline-flex"
          >
            {branchLabel}
          </Pill>
        ) : null}

        {repoPath ? (
          <OpenInEditorMenu
            repoPath={repoPath}
            onOpenCliEditor={onOpenCliEditor}
          />
        ) : null}

        <div ref={panelMenuRef} className="relative flex items-center shrink-0">
          <IconButton
            aria-label="Panel views menu"
            onClick={() => setPanelMenuOpen((value) => !value)}
            active={panelMenuOpen || rightPanelOpen}
          >
            <PanelsMenuIcon />
          </IconButton>

          {panelMenuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-8 z-50 w-56 overflow-hidden rounded-card border border-hairline bg-card-raised/95 py-1 shadow-xl shadow-black/40 backdrop-blur-md"
            >
              <button
                type="button"
                role="menuitem"
                disabled={!hasDiff}
                onClick={() => {
                  setPanelMenuOpen(false)
                  onToggleRightPanel('diff')
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-primary transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:text-muted/40 disabled:hover:bg-transparent"
              >
                <DiffIcon />
                <span className="flex-1">Diff</span>
                {diffActive ? (
                  <span className="text-accent-primary">
                    <CheckIcon />
                  </span>
                ) : !hasDiff ? (
                  <span className="text-[10px] font-normal text-muted/60">No changes</span>
                ) : null}
              </button>

              <button
                type="button"
                role="menuitem"
                disabled={!hasSwarmGraph}
                onClick={() => {
                  setPanelMenuOpen(false)
                  onToggleRightPanel('swarm')
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-primary transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:text-muted/40 disabled:hover:bg-transparent"
              >
                <GraphIcon />
                <span className="flex-1">Swarm</span>
                {swarmActive ? (
                  <span className="text-accent-primary">
                    <CheckIcon />
                  </span>
                ) : !hasSwarmGraph ? (
                  <span className="text-[10px] font-normal text-muted/60">Inactive</span>
                ) : null}
              </button>

              <button
                type="button"
                role="menuitem"
                disabled={!hasContext}
                onClick={() => {
                  setPanelMenuOpen(false)
                  onToggleRightPanel('context')
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-primary transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:text-muted/40 disabled:hover:bg-transparent"
              >
                <ContextIcon />
                <span className="flex-1">Context</span>
                {contextActive ? (
                  <span className="text-accent-primary">
                    <CheckIcon />
                  </span>
                ) : !hasContext ? (
                  <span className="text-[10px] font-normal text-muted/60">Unavailable</span>
                ) : null}
              </button>

              <button
                type="button"
                role="menuitem"
                disabled={!hasReviews}
                onClick={() => {
                  setPanelMenuOpen(false)
                  onToggleRightPanel('reviews')
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-primary transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:text-muted/40 disabled:hover:bg-transparent"
              >
                <ReviewInboxIcon />
                <span className="flex-1">Reviews</span>
                {reviewsActive ? (
                  <span className="text-accent-primary">
                    <CheckIcon />
                  </span>
                ) : !hasReviews ? (
                  <span className="text-[10px] font-normal text-muted/60">No reviews</span>
                ) : null}
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setPanelMenuOpen(false)
                  onToggleRightPanel('evidence')
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-primary transition-colors hover:bg-white/5"
              >
                <EvidenceIcon />
                <span className="flex-1">Evidence</span>
                {evidenceActive ? (
                  <span className="text-accent-primary">
                    <CheckIcon />
                  </span>
                ) : null}
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setPanelMenuOpen(false)
                  onToggleRightPanel('doctor')
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-primary transition-colors hover:bg-white/5"
              >
                <DoctorIcon />
                <span className="flex-1">Doctor</span>
                {doctorActive ? (
                  <span className="text-accent-primary">
                    <CheckIcon />
                  </span>
                ) : null}
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setPanelMenuOpen(false)
                  onToggleRightPanel('terminal')
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-primary transition-colors hover:bg-white/5"
              >
                <TerminalIcon />
                <span className="flex-1">Terminal</span>
                {termActive && (
                  <span className="text-accent-primary">
                    <CheckIcon />
                  </span>
                )}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function IconButton({
  children,
  onClick,
  disabled,
  active,
  'aria-label': ariaLabel,
  className,
}: {
  children: React.ReactNode
  onClick?: () => void | Promise<void>
  disabled?: boolean
  active?: boolean
  'aria-label': string
  className?: string
}) {
  const stateClasses = disabled
    ? 'cursor-not-allowed text-muted/40'
    : active
      ? 'bg-white/10 text-primary'
      : 'text-secondary hover:bg-white/5 hover:text-primary'

  return (
    <button
      type="button"
      onClick={onClick ? () => void onClick() : undefined}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={`h-7 w-7 items-center justify-center rounded transition-colors ${stateClasses} ${
        className ?? 'flex'
      }`}
    >
      {children}
    </button>
  )
}

function MenuIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  )
}

function EllipsisIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="6 4 20 12 6 20" />
    </svg>
  )
}

function BranchIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

function DiffIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4v16" />
      <path d="M3 8h6" />
      <path d="M3 16h6" />
      <path d="M15 8h6" />
      <path d="M18 5v6" />
      <path d="M18 13v6" />
    </svg>
  )
}

function TerminalIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

function GraphIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M8.5 6h7" />
      <path d="M7.5 8.2 10.6 15.8" />
      <path d="M16.5 8.2 13.4 15.8" />
    </svg>
  )
}

function ContextIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
      <path d="M8 9h6" />
      <path d="M8 12h4" />
    </svg>
  )
}

function ReviewInboxIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4h16v16H4z" />
      <path d="M8 9h8" />
      <path d="M8 14h5" />
      <path d="m15 14 1.5 1.5L20 12" />
    </svg>
  )
}

function DoctorIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="M9 12l2 2 4-5" />
    </svg>
  )
}

function EvidenceIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 15-4.5-4.5L7 20" />
      <path d="M14 20l3.5-3.5L21 20" />
    </svg>
  )
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      {collapsed ? (
        <path d="M12 10l2 2-2 2" />
      ) : (
        <path d="M14 14l-2-2 2-2" />
      )}
    </svg>
  )
}

function PanelsMenuIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="15" y1="3" x2="15" y2="21" />
      <line x1="15" y1="12" x2="21" y2="12" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
