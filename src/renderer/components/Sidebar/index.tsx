import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Project, SupportedAgentId } from '../../../shared/types'
import { SidebarActions } from './SidebarActions'
import { SidebarFooter } from './SidebarFooter'
import { SidebarTopZone } from './SidebarTopZone'
import { ProjectsSection } from './ProjectsSection'
import { useProjectTree, type Thread } from './useProjectTree'

const logoUrl = new URL('../../assets/lobrecs-agent-logo.png', import.meta.url).href
const RUNNING_THREAD_STATUSES = new Set(['running', 'awaiting-approval', 'awaiting-input'])

interface SidebarProps {
  isMac: boolean
  selectedProjectId: string | null
  activeThreadId: string | null
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  onSelectProject: (project: Project) => void
  onSelectThread: (project: Project, thread: Thread) => void
  onSelectThreadAgent?: (project: Project, thread: Thread, sessionId: string) => void
  onNewChat: () => void
  onNewChatForProject?: (project: Project) => void
  onSelectedProjectDeleted?: () => void
  onActiveThreadDeleted?: () => void
  onSearch?: () => void
  onPlugins?: () => void
  onAutomations?: () => void
  onOpenUsage?: () => void
  onOpenSettings?: () => void
  settingsActive?: boolean
  usageActive?: boolean
  /**
   * Optional slot overrides — if provided, these replace the corresponding
   * section. Use sparingly; defaults cover the Codex-shaped sidebar.
   */
  slots?: {
    actions?: ReactNode
    projects?: ReactNode
    footer?: ReactNode
  }
}

interface DraftProject {
  name: string
  repoPath: string
  agentId: SupportedAgentId
  modelTier: Project['modelTier']
}

function folderName(path: string) {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.at(-1) ?? 'New Project'
}

export function Sidebar({
  isMac,
  selectedProjectId,
  activeThreadId,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onSelectProject,
  onSelectThread,
  onSelectThreadAgent,
  onNewChat,
  onNewChatForProject,
  onSelectedProjectDeleted,
  onActiveThreadDeleted,
  onSearch,
  onPlugins,
  onAutomations,
  onOpenUsage,
  onOpenSettings,
  settingsActive,
  usageActive,
  slots,
}: SidebarProps) {
  const tree = useProjectTree()
  const [pendingDraft, setPendingDraft] = useState<DraftProject | null>(null)

  // Detect deletion of selected project (mirror of legacy ProjectSidebar
  // behavior). Once `tree.projects` is loaded, if the selectedProjectId is
  // no longer present, notify the caller.
  useEffect(() => {
    if (tree.loadingProjects) return
    if (!selectedProjectId) return
    if (tree.projects.some((p) => p.id === selectedProjectId)) return
    onSelectedProjectDeleted?.()
  }, [tree.loadingProjects, tree.projects, selectedProjectId, onSelectedProjectDeleted])

  const handleCreateProject = useCallback(async () => {
    try {
      const repoPath = await window.agentforge.system.selectDirectory()
      if (!repoPath) return

      // For now create with sensible defaults; richer NewProjectModal flow
      // remains in the legacy ProjectSidebar and will be re-wired in M8.
      const draft: DraftProject = {
        name: folderName(repoPath),
        repoPath,
        agentId: 'claude-code',
        modelTier: 'balanced',
      }
      setPendingDraft(draft)

      const created = await window.agentforge.projects.create({
        name: draft.name,
        repoPath: draft.repoPath,
        agentId: draft.agentId,
        modelTier: draft.modelTier,
      })
      setPendingDraft(null)
      await tree.reloadProjects()
      if (created) onSelectProject(created)
    } catch (error) {
      setPendingDraft(null)
      console.error('[sidebar] create project failed', error)
    }
  }, [onSelectProject, tree])

  const handleRenameProject = useCallback(
    async (project: Project) => {
      const nextName = window.prompt('Rename project', project.name)
      if (!nextName?.trim() || nextName.trim() === project.name) return
      try {
        await window.agentforge.projects.update(project.id, { name: nextName.trim() })
        await tree.reloadProjects()
      } catch (error) {
        console.error('[sidebar] rename project failed', error)
      }
    },
    [tree],
  )

  const handleDeleteProject = useCallback(
    async (project: Project) => {
      const confirmed = window.confirm(`Delete "${project.name}" from this workspace?`)
      if (!confirmed) return
      try {
        await window.agentforge.projects.delete(project.id)
        await tree.reloadProjects()
        if (selectedProjectId === project.id) {
          onSelectedProjectDeleted?.()
        }
      } catch (error) {
        console.error('[sidebar] delete project failed', error)
      }
    },
    [selectedProjectId, onSelectedProjectDeleted, tree],
  )

  const handleDeleteThread = useCallback(
    async (project: Project, thread: Thread) => {
      const isRunning = RUNNING_THREAD_STATUSES.has(thread.sessionStatus)
      const message = isRunning
        ? `Delete "${thread.title}" and cancel its running agent?`
        : `Delete "${thread.title}" from this workspace?`
      const confirmed = window.confirm(message)
      if (!confirmed) return
      try {
        if (isRunning) {
          await window.agentforge.agent.cancel(thread.lastSessionId).catch(() => undefined)
        }
        await tree.deleteThread(project.id, thread.id)
        if (activeThreadId === thread.id) {
          onActiveThreadDeleted?.()
        }
      } catch (error) {
        console.error('[sidebar] delete thread failed', error)
      }
    },
    [activeThreadId, onActiveThreadDeleted, tree],
  )

  const projectsSlot =
    slots?.projects ?? (
      <ProjectsSection
        projects={tree.projects}
        loading={tree.loadingProjects || pendingDraft !== null}
        error={tree.projectsError}
        expandedProjects={tree.expanded}
        threadsByProject={tree.threadsByProject}
        loadingThreadsFor={tree.loadingThreadsFor}
        threadErrorByProject={tree.threadErrorByProject}
        selectedProjectId={selectedProjectId}
        activeThreadId={activeThreadId}
        onToggleExpand={(project) => tree.toggleExpand(project.id)}
        onSelectProject={onSelectProject}
        onSelectThread={onSelectThread}
        onSelectThreadAgent={onSelectThreadAgent}
        onDeleteThread={(project, thread) => void handleDeleteThread(project, thread)}
        onCreateProject={() => void handleCreateProject()}
        onRenameProject={(project) => void handleRenameProject(project)}
        onDeleteProject={(project) => void handleDeleteProject(project)}
        onNewChatForProject={onNewChatForProject}
      />
    )

  const actionsSlot =
    slots?.actions ?? (
      <SidebarActions
        onNewChat={onNewChat}
        onSearch={onSearch}
        onPlugins={onPlugins}
        onAutomations={onAutomations}
      />
    )

  const footerSlot =
    slots?.footer ?? (
      <SidebarFooter
        onOpenSettings={onOpenSettings}
        onOpenUsage={onOpenUsage}
        settingsActive={settingsActive}
        usageActive={usageActive}
      />
    )

  return (
    <aside className="flex h-full w-full min-w-0 shrink-0 flex-col bg-sidebar bg-sidebar-surface font-ui">
      <SidebarTopZone
        isMac={isMac}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={onBack}
        onForward={onForward}
        logoUrl={logoUrl}
      />
      {actionsSlot}
      {projectsSlot}
      {footerSlot}
    </aside>
  )
}

export type { Thread } from './useProjectTree'
