import { useEffect, useState, type MouseEvent } from 'react'
import type { Project } from '../../../shared/types'
import { Spinner } from '../ui'
import { ProjectTreeItem } from './ProjectTreeItem'
import type { Thread } from './useProjectTree'

interface ContextMenuState {
  project: Project
  x: number
  y: number
}

interface ProjectsSectionProps {
  projects: Project[]
  loading: boolean
  error: string | null
  expandedProjects: Set<string>
  threadsByProject: Record<string, Thread[] | undefined>
  loadingThreadsFor: Set<string>
  threadErrorByProject: Record<string, string | undefined>
  selectedProjectId: string | null
  activeThreadId: string | null
  onToggleExpand: (project: Project) => void
  onSelectProject: (project: Project) => void
  onSelectThread: (project: Project, thread: Thread) => void
  onSelectThreadAgent?: (project: Project, thread: Thread, sessionId: string) => void
  onDeleteThread?: (project: Project, thread: Thread) => void
  onCreateProject: () => void
  onRenameProject?: (project: Project) => void
  onDeleteProject?: (project: Project) => void
  onNewChatForProject?: (project: Project) => void
}

export function ProjectsSection({
  projects,
  loading,
  error,
  expandedProjects,
  threadsByProject,
  loadingThreadsFor,
  threadErrorByProject,
  selectedProjectId,
  activeThreadId,
  onToggleExpand,
  onSelectProject,
  onSelectThread,
  onSelectThreadAgent,
  onDeleteThread,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onNewChatForProject,
}: ProjectsSectionProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  useEffect(() => {
    if (!contextMenu) return
    function close() {
      setContextMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [contextMenu])

  function openContextMenu(event: MouseEvent, project: Project) {
    event.preventDefault()
    if (!onRenameProject && !onDeleteProject) return
    setContextMenu({ project, x: event.clientX, y: event.clientY })
  }

  return (
    <section className="mt-3 flex min-h-0 flex-1 flex-col">
      <header className="flex h-6 items-center justify-between pl-3 pr-2">
        <h2 className="text-[11px] font-medium tracking-wide text-muted">
          Workspaces
        </h2>
        <button
          type="button"
          onClick={onCreateProject}
          aria-label="Create workspace"
          title="Create workspace"
          className="no-drag flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-white/5 hover:text-primary"
        >
          <PlusIcon />
        </button>
      </header>

      <div className="mt-0.5 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1.5 pb-2">
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-2 text-[12px] text-muted">
            <Spinner size={12} />
            Loading projects…
          </div>
        ) : error ? (
          <div className="mx-1 rounded-card border border-accent-del/30 bg-accent-del/10 px-2 py-2 text-[11px] text-accent-del">
            {error}
          </div>
        ) : projects.length === 0 ? (
          <div className="mx-1 rounded-card border border-dashed border-hairline px-2 py-3 text-[11px] leading-5 text-muted">
            No workspaces yet. Use the plus button to add one.
          </div>
        ) : (
          projects.map((project) => (
            <ProjectTreeItem
              key={project.id}
              project={project}
              expanded={expandedProjects.has(project.id)}
              selected={selectedProjectId === project.id}
              threads={threadsByProject[project.id]}
              loadingThreads={loadingThreadsFor.has(project.id)}
              threadsError={threadErrorByProject[project.id]}
              activeThreadId={activeThreadId}
              onToggleExpand={onToggleExpand}
              onSelectProject={onSelectProject}
              onSelectThread={onSelectThread}
              onSelectThreadAgent={onSelectThreadAgent}
              onDeleteThread={onDeleteThread}
              onContextMenu={openContextMenu}
              onNewChat={onNewChatForProject}
            />
          ))
        )}
      </div>

      {contextMenu ? (
        <div
          className="fixed z-50 w-36 overflow-hidden rounded-card border border-hairline bg-card-raised/75 backdrop-blur-lg py-1 shadow-xl shadow-black/40"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {onRenameProject ? (
            <button
              type="button"
              onClick={() => {
                onRenameProject(contextMenu.project)
                setContextMenu(null)
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-primary hover:bg-white/5"
            >
              Rename
            </button>
          ) : null}
          {onDeleteProject ? (
            <button
              type="button"
              onClick={() => {
                onDeleteProject(contextMenu.project)
                setContextMenu(null)
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-accent-del hover:bg-accent-del/10"
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function PlusIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}
