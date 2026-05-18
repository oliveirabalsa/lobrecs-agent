import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Sidebar, type Thread } from '../components/Sidebar'
import { useWorkspaceController } from '../modules/workspace'
import { useWorkspaceHistory } from '../modules/workspace/hooks/useWorkspaceHistory'
import { WorkspaceView } from '../modules/workspace/views/WorkspaceView'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function RendererApp() {
  const workspace = useWorkspaceController()
  const history = useWorkspaceHistory()
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  const openThreadById = useCallback(
    async (threadId: string) => {
      const thread = await window.agentforge.threads.get(threadId).catch(() => null)
      if (!thread?.lastSessionId) return

      const session = await window.agentforge.sessions
        .get(thread.lastSessionId)
        .catch(() => null)
      if (session) workspace.handleOpenSession(session)
    },
    [workspace],
  )

  const startSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = sidebarWidth

      function handlePointerMove(moveEvent: PointerEvent) {
        const delta = moveEvent.clientX - startX
        setSidebarWidth(clamp(startWidth + delta, 220, 360))
      }

      function handlePointerUp() {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [sidebarWidth],
  )

  const handleSelectThread = useCallback(
    async (project: Parameters<typeof workspace.handleProjectSelect>[0], thread: Thread) => {
      const session = await window.agentforge.sessions.get(thread.lastSessionId).catch(() => null)
      if (session) {
        workspace.handleOpenSession(session, project)
        history.push(thread.id)
        setMobileSidebarOpen(false)
      }
    },
    [history, workspace],
  )

  const handleSelectProject = useCallback(
    (project: Parameters<typeof workspace.handleProjectSelect>[0]) => {
      workspace.handleProjectSelect(project)
      setMobileSidebarOpen(false)
    },
    [workspace],
  )

  const handleNewChat = useCallback(() => {
    workspace.handleNewTab()
    setMobileSidebarOpen(false)
  }, [workspace])

  const handleRerunSession = useCallback(async () => {
    const summary = await workspace.handleRerunActiveSession()
    if (summary) history.push(summary.threadId)
  }, [history, workspace])

  // Cmd+T → New chat (was: new tab). Cmd+W → close current workspace/thread.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === 't' || event.key === 'T') {
        event.preventDefault()
        handleNewChat()
      } else if (event.key === 'w' || event.key === 'W') {
        if (workspace.activeSessionId) {
          event.preventDefault()
          void workspace.handleCloseTab(workspace.activeSessionId)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleNewChat, workspace])

  const handleHistoryBack = useCallback(() => {
    const target = history.back()
    if (!target) return
    void openThreadById(target)
  }, [history, openThreadById])

  const handleHistoryForward = useCallback(() => {
    const target = history.forward()
    if (!target) return
    void openThreadById(target)
  }, [history, openThreadById])

  useEffect(() => {
    if (!mobileSidebarOpen) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileSidebarOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileSidebarOpen])

  return (
    <div className="app-shell flex w-full min-w-[320px] overflow-hidden bg-canvas text-primary">
      <div className="relative hidden shrink-0 md:flex" style={{ width: sidebarWidth }}>
        <Sidebar
          isMac={isMac}
          selectedProjectId={workspace.selectedProject?.id ?? null}
          activeThreadId={workspace.activeThreadId}
          canGoBack={history.canGoBack}
          canGoForward={history.canGoForward}
          onBack={handleHistoryBack}
          onForward={handleHistoryForward}
          onSelectProject={handleSelectProject}
          onSelectThread={(project, thread) => void handleSelectThread(project, thread)}
          onNewChat={handleNewChat}
          onSelectedProjectDeleted={workspace.handleSelectedProjectDeleted}
          onActiveThreadDeleted={workspace.handleNewTab}
        />
        <ResizeHandle side="right" onPointerDown={startSidebarResize} />
      </div>

      {mobileSidebarOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close sidebar"
            className="absolute inset-0 bg-black/55"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div
            className="relative h-full max-w-full shadow-2xl shadow-black/50"
            style={{ width: 'min(86vw, 320px)' }}
          >
            <Sidebar
              isMac={isMac}
              selectedProjectId={workspace.selectedProject?.id ?? null}
              activeThreadId={workspace.activeThreadId}
              canGoBack={history.canGoBack}
              canGoForward={history.canGoForward}
              onBack={handleHistoryBack}
              onForward={handleHistoryForward}
              onSelectProject={handleSelectProject}
              onSelectThread={(project, thread) => void handleSelectThread(project, thread)}
              onNewChat={handleNewChat}
              onSelectedProjectDeleted={workspace.handleSelectedProjectDeleted}
              onActiveThreadDeleted={workspace.handleNewTab}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 overflow-hidden">
        <WorkspaceView
          isMac={isMac}
          selectedProject={workspace.selectedProject}
          activeSession={workspace.activeSession}
          activeSessionId={workspace.activeSessionId}
          mainView={workspace.mainView}
          swarmOpen={workspace.swarmOpen}
          diffProposals={workspace.diffProposals}
          approvalRequest={workspace.approvalRequest}
          prefillPrompt={workspace.prefillPrompt}
          bannerError={workspace.bannerError}
          busy={workspace.isBusy || Boolean(workspace.approvalRequest)}
          busyReason={workspace.busyReason}
          onMainViewChange={workspace.setMainView}
          onSwarmOpenChange={workspace.setSwarmOpen}
          onCancelSession={workspace.handleCancelSession}
          onRerunSession={() => void handleRerunSession()}
          onDeleteThread={() => void workspace.handleDeleteActiveThread()}
          onForkSession={(sessionId) => void workspace.handleForkSession(sessionId)}
          onFeedback={(sessionId, outcome, note) =>
            void workspace.handleFeedback(sessionId, outcome, note)
          }
          onDiffProposals={workspace.handleDiffProposals}
          onApprovalRequest={workspace.handleApprovalRequest}
          onStatusChange={workspace.updateActiveStatus}
          onApproveApproval={workspace.handleApproveApproval}
          onRejectApproval={workspace.handleRejectApproval}
          onSessionStarted={(summary) => {
            workspace.handleSessionStarted(summary)
            history.push(summary.threadId)
          }}
          onSwarmStarted={workspace.handleSwarmStarted}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
        />
      </div>
    </div>
  )
}

function ResizeHandle({
  side,
  onPointerDown,
}: {
  side: 'left' | 'right'
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className={`absolute top-0 z-20 h-full w-2 cursor-col-resize ${
        side === 'left' ? '-left-1' : '-right-1'
      }`}
    >
      <div className="mx-auto h-full w-px bg-transparent transition hover:bg-accent-primary/60" />
    </div>
  )
}
