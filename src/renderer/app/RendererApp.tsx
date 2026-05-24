import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ThreadSearchResult } from '../../shared/types'
import { SearchPalette } from '../components/SearchPalette'
import { Sidebar, type Thread } from '../components/Sidebar'
import { CliToolsView } from '../modules/cli-tools'
import { ExtensionMarketplaceView } from '../modules/extensions'
import { useNotificationRouting } from '../modules/notifications'
import { OnboardingFlow, resetOnboarding, shouldShowOnboarding } from '../modules/onboarding'
import { SettingsView, useSettings } from '../modules/settings'
import { AppUpdateBanner } from '../modules/updates'
import { useWorkspaceController } from '../modules/workspace'
import { useWorkspaceHistory } from '../modules/workspace/hooks/useWorkspaceHistory'
import { WorkspaceView } from '../modules/workspace/views/WorkspaceView'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 420

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function RendererApp() {
  const workspace = useWorkspaceController()
  const { globalSettings } = useSettings()
  const history = useWorkspaceHistory()
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [sidebarWidthTouched, setSidebarWidthTouched] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('lobrecs.sidebar-collapsed') === 'true'
    } catch {
      return false
    }
  })

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem('lobrecs.sidebar-collapsed', String(next))
      } catch {}
      return next
    })
  }, [])
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobileSidebarMounted, setMobileSidebarMounted] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    try {
      return shouldShowOnboarding(window.localStorage)
    } catch {
      return false
    }
  })
  const [shellView, setShellView] = useState<'workspace' | 'settings' | 'extensions' | 'cli-tools'>(
    'workspace',
  )
  const [openTerminalOnMount, setOpenTerminalOnMount] = useState(false)

  // Keep the mobile drawer mounted while opening, and during the close
  // animation so the `data-state="closed"` exit keyframes can play before
  // unmount. The drawer's `onAnimationEnd` flips this back to false.
  useEffect(() => {
    if (mobileSidebarOpen) setMobileSidebarMounted(true)
  }, [mobileSidebarOpen])

  const openThreadById = useCallback(
    async (threadId: string) => {
      const thread = await window.agentforge.threads.get(threadId).catch(() => null)
      if (!thread?.lastSessionId) return

      const session = await window.agentforge.sessions
        .get(thread.lastSessionId)
        .catch(() => null)
      if (session) {
        workspace.handleOpenSession(session)
        setShellView('workspace')
      }
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
        setSidebarWidth(clamp(startWidth + delta, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH))
        setSidebarWidthTouched(true)
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

  useEffect(() => {
    if (sidebarWidthTouched) return
    const width = globalSettings?.ui.sidebarDefaultWidth
    if (!width) return
    setSidebarWidth(clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH))
  }, [globalSettings?.ui.sidebarDefaultWidth, sidebarWidthTouched])

  const handleSelectThread = useCallback(
    async (project: Parameters<typeof workspace.handleProjectSelect>[0], thread: Thread) => {
      const session = await window.agentforge.sessions.get(thread.lastSessionId).catch(() => null)
      if (session) {
        workspace.handleOpenSession(session, project)
        history.push(thread.id)
        setMobileSidebarOpen(false)
        setShellView('workspace')
      }
    },
    [history, workspace],
  )

  const handleSelectThreadAgent = useCallback(
    async (
      project: Parameters<typeof workspace.handleProjectSelect>[0],
      thread: Thread,
      sessionId: string,
    ) => {
      const session = await window.agentforge.sessions.get(sessionId).catch(() => null)
      if (session) {
        workspace.handleOpenSession(session, project)
        history.push(thread.id)
        setMobileSidebarOpen(false)
        setShellView('workspace')
      }
    },
    [history, workspace],
  )

  const handleSelectProject = useCallback(
    (project: Parameters<typeof workspace.handleProjectSelect>[0]) => {
      workspace.handleProjectSelect(project)
      setMobileSidebarOpen(false)
      setShellView('workspace')
    },
    [workspace],
  )

  const handleNewChat = useCallback(() => {
    workspace.handleNewTab()
    setMobileSidebarOpen(false)
    setShellView('workspace')
  }, [workspace])

  const handleNewChatForProject = useCallback(
    (project: Parameters<typeof workspace.handleNewChatForProject>[0]) => {
      workspace.handleNewChatForProject(project)
      setMobileSidebarOpen(false)
      setShellView('workspace')
    },
    [workspace],
  )

  const handleRerunSession = useCallback(async () => {
    const summary = await workspace.handleRerunActiveSession()
    if (summary) history.push(summary.threadId)
  }, [history, workspace])

  const handleOpenSearch = useCallback(() => {
    setSearchOpen(true)
    setMobileSidebarOpen(false)
  }, [])

  const handleOpenAutomations = useCallback(() => {
    workspace.setMainView('automations')
    setMobileSidebarOpen(false)
    setShellView('workspace')
  }, [workspace])

  const handleOpenGitGraph = useCallback(() => {
    workspace.setMainView('git-graph')
    setMobileSidebarOpen(false)
    setShellView('workspace')
  }, [workspace])

  const handleOpenExtensions = useCallback(() => {
    setShellView('extensions')
    setMobileSidebarOpen(false)
  }, [])

  const handleOpenCliTools = useCallback(() => {
    setShellView('cli-tools')
    setMobileSidebarOpen(false)
  }, [])

  const handleOpenSearchResult = useCallback(
    async (result: ThreadSearchResult) => {
      const sessionId = result.sessionId ?? result.thread.lastSessionId
      if (!sessionId) return

      const session = await window.agentforge.sessions.get(sessionId).catch(() => null)
      if (!session) return

      workspace.handleOpenSession(session, result.project)
      history.push(result.thread.id)
      setShellView('workspace')
    },
    [history, workspace],
  )

  // Cmd+T → New chat. Cmd+W → close current workspace/thread. Cmd+K → Search. Cmd+B → Toggle sidebar.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === 't' || event.key === 'T') {
        event.preventDefault()
        handleNewChat()
      } else if (event.key === 'k' || event.key === 'K') {
        event.preventDefault()
        handleOpenSearch()
      } else if (event.key === 'w' || event.key === 'W') {
        if (workspace.activeSessionId) {
          event.preventDefault()
          void workspace.handleCloseTab(workspace.activeSessionId)
        }
      } else if (event.key === 'b' || event.key === 'B') {
        event.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleNewChat, handleOpenSearch, workspace, toggleSidebar])

  // Ctrl+; — when in settings, switch back to workspace and signal WorkspaceView to open terminal.
  // When already in workspace, WorkspaceView handles the toggle directly via its own listener.
  useEffect(() => {
    const unsub = window.agentforge.onShortcut('shortcut:toggle-terminal', () => {
      if (shellView === 'settings') {
        setShellView('workspace')
        setOpenTerminalOnMount(true)
      }
    })
    return unsub
  }, [shellView])

  useNotificationRouting({ workspace, history, setShellView })

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

  const handleOpenSettings = useCallback(() => {
    setShellView('settings')
    setMobileSidebarOpen(false)
  }, [])

  const handleOpenUsage = useCallback(() => {
    workspace.setMainView('costs')
    setShellView('workspace')
    setMobileSidebarOpen(false)
  }, [workspace])

  const handleCloseSettings = useCallback(() => {
    setShellView('workspace')
  }, [])

  const handleReplayWalkthrough = useCallback(() => {
    try {
      resetOnboarding(window.localStorage)
    } catch {}
    setOnboardingOpen(true)
  }, [])

  useEffect(() => {
    if (!mobileSidebarOpen) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileSidebarOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileSidebarOpen])

  useEffect(() => {
    if (shellView !== 'settings' && shellView !== 'extensions' && shellView !== 'cli-tools') return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setShellView('workspace')
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shellView])

  return (
    <div className="app-shell flex w-full min-w-[320px] overflow-hidden bg-canvas text-primary">
      {!sidebarCollapsed && (
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
          onSelectThreadAgent={(project, thread, sessionId) =>
            void handleSelectThreadAgent(project, thread, sessionId)
          }
          onNewChat={handleNewChat}
          onNewChatForProject={handleNewChatForProject}
          onSelectedProjectDeleted={workspace.handleSelectedProjectDeleted}
          onActiveThreadDeleted={workspace.handleNewTab}
          onSearch={handleOpenSearch}
          onPlugins={handleOpenExtensions}
          onCliTools={handleOpenCliTools}
          onAutomations={workspace.selectedProject ? handleOpenAutomations : undefined}
          onOpenGitGraph={workspace.selectedProject ? handleOpenGitGraph : undefined}
          onOpenUsage={handleOpenUsage}
          onOpenSettings={handleOpenSettings}
          settingsActive={shellView === 'settings'}
          cliToolsActive={shellView === 'cli-tools'}
          gitGraphActive={shellView === 'workspace' && workspace.mainView === 'git-graph'}
          usageActive={shellView === 'workspace' && workspace.mainView === 'costs'}
        />
        <ResizeHandle side="right" onPointerDown={startSidebarResize} />
      </div>
      )}

      {mobileSidebarMounted ? (
        <div
          className="fixed inset-0 z-50 md:hidden"
          aria-hidden={!mobileSidebarOpen}
        >
          <button
            type="button"
            aria-label="Close sidebar"
            data-motion="drawer-overlay"
            data-state={mobileSidebarOpen ? 'open' : 'closed'}
            className="absolute inset-0 bg-black/55"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div
            data-motion="drawer-left"
            data-state={mobileSidebarOpen ? 'open' : 'closed'}
            className="relative h-full max-w-full shadow-2xl shadow-black/50"
            style={{ width: 'min(86vw, 320px)' }}
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget) return
              if (!mobileSidebarOpen) setMobileSidebarMounted(false)
            }}
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
              onSelectThreadAgent={(project, thread, sessionId) =>
                void handleSelectThreadAgent(project, thread, sessionId)
              }
              onNewChat={handleNewChat}
              onNewChatForProject={handleNewChatForProject}
              onSelectedProjectDeleted={workspace.handleSelectedProjectDeleted}
              onActiveThreadDeleted={workspace.handleNewTab}
              onSearch={handleOpenSearch}
              onPlugins={handleOpenExtensions}
              onCliTools={handleOpenCliTools}
              onAutomations={workspace.selectedProject ? handleOpenAutomations : undefined}
              onOpenGitGraph={workspace.selectedProject ? handleOpenGitGraph : undefined}
              onOpenUsage={handleOpenUsage}
              onOpenSettings={handleOpenSettings}
              settingsActive={shellView === 'settings'}
              cliToolsActive={shellView === 'cli-tools'}
              gitGraphActive={shellView === 'workspace' && workspace.mainView === 'git-graph'}
              usageActive={shellView === 'workspace' && workspace.mainView === 'costs'}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 overflow-hidden">
        {shellView === 'settings' ? (
          <SettingsView
            isMac={isMac}
            selectedProject={workspace.selectedProject}
            onOpenSidebar={() => setMobileSidebarOpen(true)}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebar}
            onClose={handleCloseSettings}
            onReplayWalkthrough={handleReplayWalkthrough}
          />
        ) : shellView === 'extensions' ? (
          <ExtensionMarketplaceView
            isMac={isMac}
            selectedProject={workspace.selectedProject}
            onOpenSidebar={() => setMobileSidebarOpen(true)}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebar}
            onClose={handleCloseSettings}
          />
        ) : shellView === 'cli-tools' ? (
          <CliToolsView
            isMac={isMac}
            selectedProject={workspace.selectedProject}
            onOpenSidebar={() => setMobileSidebarOpen(true)}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebar}
            onClose={handleCloseSettings}
          />
        ) : (
          <WorkspaceView
          isMac={isMac}
          selectedProject={workspace.selectedProject}
          activeSession={workspace.activeSession}
          activeSessionId={workspace.activeSessionId}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
          mainView={workspace.mainView}
          swarmOpen={workspace.swarmOpen}
          diffProposals={workspace.diffProposals}
          approvalRequest={workspace.approvalRequest}
          prefillPrompt={workspace.prefillPrompt}
          bannerError={workspace.bannerError}
          busy={workspace.isBusy || Boolean(workspace.approvalRequest)}
          busyReason={workspace.busyReason}
          onBannerError={workspace.handleWorkspaceError}
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
          onOpenSession={(session) => {
            workspace.handleOpenSession(session)
            if (session.threadId) history.push(session.threadId)
          }}
          onSessionStarted={(summary) => {
            workspace.handleSessionStarted(summary)
            history.push(summary.threadId)
          }}
          onProjectUpdated={workspace.handleProjectUpdated}
          onSwarmStarted={(result) => {
            workspace.handleSwarmStarted(result)
            history.push(result.threadId)
          }}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
          pendingQueue={workspace.pendingQueue}
          onEnqueue={workspace.handleEnqueue}
          onDelegateTask={workspace.handleDelegateTask}
          onForceSteerQueuedMessage={workspace.handleForceSteerQueuedMessage}
          onRemoveQueueItem={workspace.handleRemoveQueueItem}
          onClearQueue={workspace.handleClearQueue}
          openTerminalOnMount={openTerminalOnMount}
          onTerminalOpened={() => setOpenTerminalOnMount(false)}
          />
        )}
      </div>
      <SearchPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onOpenResult={(result) => void handleOpenSearchResult(result)}
      />
      <OnboardingFlow
        open={onboardingOpen}
        selectedProject={workspace.selectedProject}
        onClose={() => setOnboardingOpen(false)}
        onProjectCreated={(project) => {
          workspace.handleProjectSelect(project)
          setShellView('workspace')
        }}
        onSwarmStarted={(result) => {
          workspace.handleSwarmStarted(result)
          history.push(result.threadId)
          setShellView('workspace')
        }}
      />
      <AppUpdateBanner />
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
