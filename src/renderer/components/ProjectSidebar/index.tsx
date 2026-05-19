import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { Project, Session } from '../../../shared/types'
import { NewProjectModal } from './NewProjectModal'
import { ProjectItem } from './ProjectItem'

const logoUrl = new URL('../../assets/lobrecs-agent-logo.png', import.meta.url).href

interface Props {
  selectedProjectId: string | null
  onSelect: (project: Project) => void
  onSelectedProjectDeleted?: () => void
}

interface ContextMenuState {
  project: Project
  x: number
  y: number
}

interface DraftProject {
  name: string
  repoPath: string
  agentId: 'claude-code' | 'codex' | 'opencode'
  modelTier: Project['modelTier']
}

const ACTIVE_STATUSES: Session['status'][] = ['running', 'awaiting-approval']

function folderName(path: string) {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.at(-1) ?? 'New Project'
}

function isActiveSession(session: Session) {
  return ACTIVE_STATUSES.includes(session.status)
}

export function ProjectSidebar({ selectedProjectId, onSelect, onSelectedProjectDeleted }: Props) {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeSessionCounts, setActiveSessionCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [draft, setDraft] = useState<DraftProject | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false

    window.agentforge.projects
      .list()
      .then((loadedProjects) => {
        if (cancelled) return
        setProjects(loadedProjects)
        setError(null)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'Failed to load projects')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (projects.length === 0) {
      setActiveSessionCounts({})
      return
    }

    let cancelled = false

    Promise.all(
      projects.map(async (project) => {
        try {
          const sessions = await window.agentforge.sessions.list(project.id)
          return [project.id, sessions.filter(isActiveSession).length] as const
        } catch {
          return [project.id, 0] as const
        }
      }),
    ).then((entries) => {
      if (!cancelled) setActiveSessionCounts(Object.fromEntries(entries))
    })

    return () => {
      cancelled = true
    }
  }, [projects])

  useEffect(() => {
    function closeMenu() {
      setContextMenu(null)
    }

    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
    }
  }, [])

  const selectedExists = useMemo(
    () => projects.some((project) => project.id === selectedProjectId),
    [projects, selectedProjectId],
  )
  const activeProjectCount = useMemo(
    () => Object.values(activeSessionCounts).filter((count) => count > 0).length,
    [activeSessionCounts],
  )
  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return projects

    return projects.filter((project) => {
      return (
        project.name.toLowerCase().includes(normalizedQuery) ||
        project.repoPath.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [projects, query])

  useEffect(() => {
    if (selectedProjectId && !selectedExists && !loading) {
      onSelectedProjectDeleted?.()
    }
  }, [loading, onSelectedProjectDeleted, selectedExists, selectedProjectId])

  async function handleCreateClick() {
    setError(null)
    const repoPath = await window.agentforge.system.selectDirectory()
    if (!repoPath) return

    setDraft({
      name: folderName(repoPath),
      repoPath,
      agentId: 'claude-code',
      modelTier: 'balanced',
    })
    setModalOpen(true)
  }

  async function handleCreate(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) {
    setCreating(true)
    setError(null)

    try {
      const createdProject = await window.agentforge.projects.create(data)
      if (!createdProject) {
        throw new Error('Project creation is not available yet')
      }
      setProjects((current) => [createdProject, ...current])
      setModalOpen(false)
      setDraft(null)
      onSelect(createdProject)
    } catch (createError: unknown) {
      setError(createError instanceof Error ? createError.message : 'Failed to create project')
    } finally {
      setCreating(false)
    }
  }

  function openContextMenu(event: MouseEvent, project: Project) {
    event.preventDefault()
    setContextMenu({ project, x: event.clientX, y: event.clientY })
  }

  async function handleRename(project: Project) {
    setContextMenu(null)
    const nextName = window.prompt('Rename project', project.name)
    if (!nextName?.trim() || nextName.trim() === project.name) return

    try {
      const updatedProject = await window.agentforge.projects.update(project.id, {
        name: nextName.trim(),
      })
      setProjects((current) =>
        current.map((item) => (item.id === project.id ? { ...item, ...updatedProject } : item)),
      )
      if (selectedProjectId === project.id) {
        onSelect({ ...project, ...updatedProject })
      }
    } catch (renameError: unknown) {
      setError(renameError instanceof Error ? renameError.message : 'Failed to rename project')
    }
  }

  async function handleDelete(project: Project) {
    setContextMenu(null)
    const confirmed = window.confirm(`Delete "${project.name}" from this workspace?`)
    if (!confirmed) return

    try {
      await window.agentforge.projects.delete(project.id)
      setProjects((current) => current.filter((item) => item.id !== project.id))
      if (selectedProjectId === project.id) {
        onSelectedProjectDeleted?.()
      }
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete project')
    }
  }

  return (
    <aside className="flex w-full min-w-0 shrink-0 flex-col bg-zinc-900">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-3">
        <img
          src={logoUrl}
          alt=""
          aria-hidden="true"
          className="h-9 w-9 shrink-0 rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-zinc-100">Lobrecs Agent</div>
          <div className="truncate text-xs text-zinc-500">Local coding agents</div>
        </div>
        <button
          type="button"
          onClick={handleCreateClick}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-lg leading-none text-zinc-100 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="Create project"
          title="Create project"
        >
          +
        </button>
      </div>

      <div className="border-b border-zinc-800 px-3 py-3">
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-2">
            <div className="text-zinc-500">Projects</div>
            <div className="mt-1 font-semibold text-zinc-100">{projects.length}</div>
          </div>
          <div className="rounded-md border border-blue-900/50 bg-blue-950/20 px-2 py-2">
            <div className="text-blue-200/70">Active</div>
            <div className="mt-1 font-semibold text-blue-100">{activeProjectCount}</div>
          </div>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mt-3 h-8 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-blue-500"
          placeholder="Search repositories"
          aria-label="Search projects"
        />
      </div>

      {error ? (
        <div className="m-2 rounded-md border border-red-900/70 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loading ? (
          <div className="px-3 py-2 text-xs text-zinc-500">Loading projects...</div>
        ) : filteredProjects.length > 0 ? (
          filteredProjects.map((project) => (
            <ProjectItem
              key={project.id}
              project={project}
              selected={selectedProjectId === project.id}
              activeSessionCount={activeSessionCounts[project.id] ?? 0}
              onSelect={onSelect}
              onContextMenu={openContextMenu}
            />
          ))
        ) : (
          <div className="rounded-md border border-dashed border-zinc-800 px-3 py-4 text-xs leading-5 text-zinc-500">
            {projects.length === 0
              ? 'No projects yet. Use the plus button to choose a repository.'
              : 'No repositories match this search.'}
          </div>
        )}
      </div>

      {contextMenu ? (
        <div
          className="fixed z-50 w-36 overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/40"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => void handleRename(contextMenu.project)}
            className="block w-full px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => void handleDelete(contextMenu.project)}
            className="block w-full px-3 py-1.5 text-left text-xs text-red-300 hover:bg-red-950/60"
          >
            Delete
          </button>
        </div>
      ) : null}

      <NewProjectModal
        open={modalOpen}
        draft={draft}
        creating={creating}
        error={error}
        onOpenChange={setModalOpen}
        onCreate={(data) => void handleCreate(data)}
      />
    </aside>
  )
}
