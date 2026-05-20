import { useEffect, useState, type MouseEvent } from 'react'
import type { Project } from '../../../shared/types'
import { Spinner } from '../ui'
import { ThreadRow } from './ThreadRow'
import type { Thread } from './useProjectTree'

const COLLAPSED_THREAD_LIMIT = 10

interface ProjectTreeItemProps {
  project: Project
  expanded: boolean
  selected: boolean
  threads: Thread[] | undefined
  loadingThreads: boolean
  threadsError?: string
  activeThreadId: string | null
  onToggleExpand: (project: Project) => void
  onSelectProject: (project: Project) => void
  onSelectThread: (project: Project, thread: Thread) => void
  onDeleteThread?: (project: Project, thread: Thread) => void
  onContextMenu?: (event: MouseEvent, project: Project) => void
  onNewChat?: (project: Project) => void
}

export function ProjectTreeItem({
  project,
  expanded,
  selected,
  threads,
  loadingThreads,
  threadsError,
  activeThreadId,
  onToggleExpand,
  onSelectProject,
  onSelectThread,
  onDeleteThread,
  onContextMenu,
  onNewChat,
}: ProjectTreeItemProps) {
  const [showAll, setShowAll] = useState(false)
  // Keep the threads container mounted during the close animation. Flipped
  // back to false on `onAnimationEnd` so the DOM stays light when collapsed.
  const [threadsMounted, setThreadsMounted] = useState(expanded)

  useEffect(() => {
    if (expanded) setThreadsMounted(true)
  }, [expanded])

  function handleRowClick() {
    if (expanded && selected) {
      onToggleExpand(project)
    } else {
      onSelectProject(project)
      if (!expanded) onToggleExpand(project)
    }
  }

  function handleChevronClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    onToggleExpand(project)
  }

  function handleContextMenu(event: MouseEvent) {
    if (onContextMenu) onContextMenu(event, project)
  }

  const allThreads = threads ?? []
  const overLimit = allThreads.length > COLLAPSED_THREAD_LIMIT
  const visibleThreads = overLimit && !showAll
    ? allThreads.slice(0, COLLAPSED_THREAD_LIMIT)
    : allThreads
  const hiddenCount = overLimit && !showAll ? allThreads.length - COLLAPSED_THREAD_LIMIT : 0
  const rowBase =
    'group flex h-8 w-full items-center gap-1.5 rounded-card pl-1.5 pr-2 transition-colors cursor-pointer'
  const rowState = selected
    ? 'bg-white/8 text-primary'
    : 'text-secondary hover:bg-white/5 hover:text-primary'

  return (
    <div className="flex flex-col">
      <div
        className={`${rowBase} ${rowState}`}
        onContextMenu={handleContextMenu}
        onClick={handleRowClick}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handleRowClick()
          }
        }}
      >
        <button
          type="button"
          onClick={handleChevronClick}
          aria-label={expanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
          className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-muted hover:text-primary"
        >
          <ChevronIcon open={expanded} />
        </button>
        <div
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={project.repoPath}
        >
          <FolderIcon />
          <span className="min-w-0 flex-1 truncate text-[13px] leading-none">
            {project.name}
          </span>
        </div>
        {onNewChat ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onNewChat(project)
            }}
            aria-label={`New chat in ${project.name}`}
            title="New chat"
            className="no-drag flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 text-muted hover:bg-white/10 hover:text-primary group-hover:opacity-100 focus-visible:opacity-100"
          >
            <PencilIcon />
          </button>
        ) : null}
      </div>

      {threadsMounted ? (
        <div
          data-motion="collapsible"
          data-state={expanded ? 'open' : 'closed'}
          className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-hairline pl-2"
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) return
            if (!expanded) setThreadsMounted(false)
          }}
        >
          {loadingThreads && allThreads.length === 0 ? (
            <div className="flex h-8 items-center gap-2 px-2 text-[12px] text-muted">
              <Spinner size={12} />
              Loading threads…
            </div>
          ) : threadsError ? (
            <div className="px-2 py-1 text-[12px] text-accent-del">{threadsError}</div>
          ) : allThreads.length === 0 ? (
            <div className="px-2 py-1 text-[12px] text-muted">No threads yet</div>
          ) : (
            <>
              {visibleThreads.map((thread, index) => (
                <div
                  key={thread.id}
                  className="motion-fade-up-in"
                  style={{ animationDelay: `${Math.min(index, 12) * 16}ms` }}
                >
                  <ThreadRow
                    thread={thread}
                    active={activeThreadId === thread.id}
                    onSelect={(t) => onSelectThread(project, t)}
                    onDelete={onDeleteThread ? (t) => onDeleteThread(project, t) : undefined}
                  />
                </div>
              ))}
              {overLimit ? (
                <button
                  type="button"
                  onClick={() => setShowAll((value) => !value)}
                  className="mt-0.5 self-start rounded px-2 py-1 text-[10px] text-muted hover:text-primary cursor-pointer"
                >
                  {showAll ? 'Show less' : `Show more (${hiddenCount})`}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

function PencilIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function FolderIcon() {
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
      className="shrink-0 text-muted"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 120ms ease-out',
      }}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}
