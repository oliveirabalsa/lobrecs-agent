import { useEffect } from 'react'
import type { NotificationClickPayload } from '../../../shared/contracts'
import type { useWorkspaceController } from '../workspace/hooks/useWorkspaceController'
import type { useWorkspaceHistory } from '../workspace/hooks/useWorkspaceHistory'

type WorkspaceController = ReturnType<typeof useWorkspaceController>
type WorkspaceHistory = ReturnType<typeof useWorkspaceHistory>

export interface NotificationRoutingOptions {
  workspace: WorkspaceController
  history: WorkspaceHistory
  setShellView: (view: 'workspace') => void
}

export function useNotificationRouting({
  workspace,
  history,
  setShellView,
}: NotificationRoutingOptions): void {
  useEffect(() => {
    const unsubscribe = window.agentforge.notifications.onClick((payload) => {
      void routeNotificationClick(payload, { workspace, history, setShellView })
    })
    return unsubscribe
  }, [workspace, history, setShellView])
}

async function routeNotificationClick(
  payload: NotificationClickPayload,
  { workspace, history, setShellView }: NotificationRoutingOptions,
): Promise<void> {
  setShellView('workspace')

  const sessionId =
    payload.sessionId ??
    (payload.threadId
      ? (await window.agentforge.threads.get(payload.threadId).catch(() => null))?.lastSessionId
      : undefined)

  if (sessionId) {
    const session = await window.agentforge.sessions.get(sessionId).catch(() => null)
    if (session) {
      const project = await resolveProject(payload.projectId)
      workspace.handleOpenSession(session, project)
      if (session.threadId) history.push(session.threadId)
      return
    }
  }

  const project = await resolveProject(payload.projectId)
  if (project) workspace.handleProjectSelect(project)
}

async function resolveProject(projectId: string) {
  const projects = await window.agentforge.projects.list().catch(() => [])
  return projects.find((project) => project.id === projectId)
}
