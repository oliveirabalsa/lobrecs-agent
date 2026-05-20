import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type {
  AgentId,
  ApprovalRequest,
  DiffProposal,
  EditorInfo,
  Project,
  QueuedMessage,
  SessionStatus,
} from '../../../../shared/types'
import { DiffViewer } from '../../../components/DiffViewer'
import { AutomationManager } from '../../automations'
import { CostDashboard } from '../../costs'
import {
  TerminalPanel,
  type ActiveSessionMeta,
  type StartedSessionSummary,
} from '../../sessions'
import { SwarmBuilder, SwarmGraphPanel } from '../../swarms'
import { useSettings } from '../../settings'
import {
  BottomTerminalPanel,
  createTerminalTab,
  type TerminalTab,
} from '../components/BottomTerminalPanel'
import { resolveBottomTerminalOpenAction } from '../components/bottomTerminalPanelState'
import { CommitAndPushDialog } from '../components/CommitAndPushDialog'
import { Composer } from '../components/Composer'
import { ProjectContextDialog } from '../components/ProjectContextDialog'
import { QueueBanner } from '../components/QueueBanner'
import { WorkspaceEmpty } from '../components/WorkspaceEmpty'
import { WorkspaceTopBar, type RightPanelMode } from '../components/WorkspaceTopBar'
import type { DiffProposalScope, MainView } from '../hooks/useWorkspaceController'
import { RunWorkspace } from './RunWorkspace'
import type { SwarmGraphNode } from '../../swarms/domain/swarmGraph'

interface WorkspaceViewProps {
  isMac?: boolean
  selectedProject: Project | null
  activeSession: ActiveSessionMeta | null
  activeSessionId: string | null
  mainView: MainView
  swarmOpen: boolean
  diffProposals: DiffProposal[]
  approvalRequest: ApprovalRequest | null
  prefillPrompt?: string
  bannerError: string | null
  busy: boolean
  busyReason?: string
  onBannerError: (message: string) => void
  onMainViewChange: Dispatch<SetStateAction<MainView>>
  onSwarmOpenChange: Dispatch<SetStateAction<boolean>>
  onCancelSession: (sessionId: string) => void | Promise<void>
  onRerunSession?: () => void | Promise<void>
  onDeleteThread: () => void
  onForkSession: (sessionId: string) => void
  onFeedback: (
    sessionId: string,
    outcome: 'success' | 'failure' | 'partial',
    note?: string,
  ) => void
  onDiffProposals: (proposals: DiffProposal[], source?: DiffProposalScope) => void
  onApprovalRequest: (request: ApprovalRequest | null) => void
  onStatusChange: (status: SessionStatus) => void
  onApproveApproval: () => void | Promise<void>
  onRejectApproval: () => void | Promise<void>
  onSessionStarted: (session: StartedSessionSummary) => void
  onProjectUpdated?: (project: Project) => void
  onSwarmStarted: (result: {
    swarmId: string
    threadId: string
    sessions: Array<{
      sessionId: string
      threadId: string
      role: string
      status: string
      agentId?: Project['agentId']
      model?: string
    }>
  }) => void
  onOpenSidebar?: () => void
  /** Pending queued messages for the active thread. */
  pendingQueue: QueuedMessage[]
  onEnqueue: (
    prompt: string,
    agentId?: AgentId,
    modelOverride?: string,
  ) => void | Promise<void>
  onSteer: (prompt: string) => void | Promise<void>
  onRemoveQueueItem: (messageId: string) => void | Promise<void>
  onClearQueue: () => void | Promise<void>
  /** When true, WorkspaceView opens the terminal as soon as it mounts (used when switching from settings view). */
  openTerminalOnMount?: boolean
  onTerminalOpened?: () => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
}

const MAIN_VIEWS: MainView[] = ['workspace', 'costs', 'automations']
const RIGHT_PANEL_FULLSCREEN_CLASS =
  'absolute inset-0 z-50 flex min-w-0 flex-col border-l border-hairline bg-canvas shadow-2xl shadow-black/50'
const RIGHT_PANEL_DOCKED_CLASS =
  'absolute inset-y-0 right-0 z-30 flex w-full min-w-0 flex-col border-l border-hairline bg-canvas ' +
  'shadow-2xl shadow-black/40 sm:w-[420px] lg:relative lg:inset-auto lg:z-auto lg:w-[420px] ' +
  'lg:min-w-[320px] lg:max-w-[720px] lg:shrink-0 lg:shadow-none 2xl:w-[520px]'

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function rightPanelOpenKey(threadId: string | null): string {
  return threadId ? `workspace.rightPanelOpen.${threadId}` : 'workspace.rightPanelOpen'
}

function rightPanelModeKey(threadId: string | null): string {
  return threadId ? `workspace.rightPanelMode.${threadId}` : 'workspace.rightPanelMode'
}

function readPanelOpen(threadId: string | null, fallback = false): boolean {
  const ls = safeStorage()
  if (!ls) return fallback
  const key = rightPanelOpenKey(threadId)
  if (ls.getItem(key) === null) return fallback
  return ls.getItem(key) === '1'
}

function readPanelMode(threadId: string | null, fallback: RightPanelMode = 'diff'): RightPanelMode {
  const ls = safeStorage()
  const key = rightPanelModeKey(threadId)
  const value = ls?.getItem(key)
  if (value === null || value === undefined) return fallback
  if (value === 'terminal' || value === 'swarm') return value
  return 'diff'
}

export function WorkspaceView({
  isMac = false,
  selectedProject,
  activeSession,
  activeSessionId,
  mainView,
  swarmOpen,
  diffProposals,
  approvalRequest,
  prefillPrompt,
  bannerError,
  busy,
  busyReason,
  onBannerError,
  onMainViewChange,
  onSwarmOpenChange,
  onCancelSession,
  onRerunSession,
  onDeleteThread,
  onForkSession,
  onFeedback,
  onDiffProposals,
  onApprovalRequest,
  onStatusChange,
  onApproveApproval,
  onRejectApproval,
  onSessionStarted,
  onProjectUpdated,
  onSwarmStarted,
  onOpenSidebar,
  pendingQueue,
  onEnqueue,
  onSteer,
  onRemoveQueueItem,
  onClearQueue,
  openTerminalOnMount,
  onTerminalOpened,
  sidebarCollapsed = false,
  onToggleSidebar,
}: WorkspaceViewProps) {
  const { globalSettings } = useSettings()
  const activeThreadId = activeSession?.threadId ?? null
  const activeThreadIdRef = useRef(activeThreadId)
  activeThreadIdRef.current = activeThreadId
  const handleActiveDiffProposals = useCallback(
    (proposals: DiffProposal[]) => {
      onDiffProposals(proposals, {
        sessionId: activeSessionId,
        threadId: activeThreadId,
      })
    },
    [activeSessionId, activeThreadId, onDiffProposals],
  )

  const [rightPanelOpen, setRightPanelOpenState] = useState<boolean>(() =>
    readPanelOpen(activeThreadId, globalSettings?.ui.rightPanelDefaultOpen ?? false),
  )
  const [rightPanelMounted, setRightPanelMounted] = useState<boolean>(() =>
    readPanelOpen(activeThreadId, globalSettings?.ui.rightPanelDefaultOpen ?? false),
  )
  const [rightPanelMode, setRightPanelModeState] = useState<RightPanelMode>(() =>
    readPanelMode(activeThreadId, globalSettings?.ui.rightPanelDefaultMode ?? 'diff'),
  )
  const [rightPanelFullscreen, setRightPanelFullscreen] = useState(false)
  const [contextDialogOpen, setContextDialogOpen] = useState(false)
  const [commitDialogOpen, setCommitDialogOpen] = useState(false)
  const [contextPercent, setContextPercent] = useState<number | null>(null)
  /** File path requested via the "Review" button — focused inside <DiffViewer>. */
  const [focusFilePath, setFocusFilePath] = useState<string | null>(null)
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false)
  const [bottomPanelFullscreen, setBottomPanelFullscreen] = useState(false)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(
    () => globalSettings?.ui.terminalDefaultHeight ?? 260,
  )
  const terminalCountRef = useRef(0)
  const bottomPanelAddTabRef = useRef<((tab: TerminalTab) => void) | null>(null)
  const [bottomPanelInitialTab, setBottomPanelInitialTab] = useState<TerminalTab | null>(null)

  // Keep the right panel mounted while opening, and during the close animation
  // so `data-state="closed"` exit keyframes can play before unmount.
  useEffect(() => {
    if (rightPanelOpen) setRightPanelMounted(true)
  }, [rightPanelOpen])

  // Restore per-thread panel state when switching threads.
  useEffect(() => {
    const open = readPanelOpen(activeThreadId, globalSettings?.ui.rightPanelDefaultOpen ?? false)
    setRightPanelOpenState(open)
    setRightPanelMounted(open)
    setRightPanelModeState(
      readPanelMode(activeThreadId, globalSettings?.ui.rightPanelDefaultMode ?? 'diff'),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId])

  useEffect(() => {
    const ls = safeStorage()
    if (ls?.getItem(rightPanelOpenKey(activeThreadIdRef.current)) !== null) return
    const defaultOpen = globalSettings?.ui.rightPanelDefaultOpen
    if (defaultOpen === undefined) return
    setRightPanelOpenState(defaultOpen)
    setRightPanelMounted(defaultOpen)
  }, [globalSettings?.ui.rightPanelDefaultOpen])

  useEffect(() => {
    const ls = safeStorage()
    if (ls?.getItem(rightPanelModeKey(activeThreadIdRef.current)) !== null) return
    const defaultMode = globalSettings?.ui.rightPanelDefaultMode
    if (!defaultMode) return
    setRightPanelModeState(defaultMode)
  }, [globalSettings?.ui.rightPanelDefaultMode])

  useEffect(() => {
    const defaultHeight = globalSettings?.ui.terminalDefaultHeight
    if (!defaultHeight || bottomPanelOpen) return
    setBottomPanelHeight(defaultHeight)
  }, [bottomPanelOpen, globalSettings?.ui.terminalDefaultHeight])

  // Persist panel state per thread.
  useEffect(() => {
    const ls = safeStorage()
    if (!ls) return
    const key = rightPanelOpenKey(activeThreadIdRef.current)
    if (rightPanelOpen) ls.setItem(key, '1')
    else ls.removeItem(key)
  }, [rightPanelOpen])

  useEffect(() => {
    const ls = safeStorage()
    if (!ls) return
    ls.setItem(rightPanelModeKey(activeThreadIdRef.current), rightPanelMode)
  }, [rightPanelMode])

  // If diff disappears while diff is selected, fall back to terminal.
  useEffect(() => {
    if (rightPanelMode === 'diff' && diffProposals.length === 0 && rightPanelOpen) {
      setRightPanelModeState('terminal')
    }
  }, [diffProposals.length, rightPanelMode, rightPanelOpen])

  useEffect(() => {
    if (rightPanelMode === 'swarm' && !activeThreadId && rightPanelOpen) {
      setRightPanelModeState('terminal')
    }
  }, [activeThreadId, rightPanelMode, rightPanelOpen])

  // The swarm graph is cramped in the docked panel width, so expand to
  // fullscreen whenever the Swarm tab opens. This intentionally omits
  // `rightPanelFullscreen` from the deps: if the user manually exits
  // fullscreen while staying on the Swarm tab, we don't fight them.
  useEffect(() => {
    if (rightPanelMode === 'swarm' && rightPanelOpen) {
      setRightPanelFullscreen(true)
    }
  }, [rightPanelMode, rightPanelOpen])

  const handleToggleRightPanel = useCallback(
    (mode: RightPanelMode) => {
      setRightPanelOpenState((prev) => {
        if (prev && rightPanelMode === mode) return false
        return true
      })
      setRightPanelModeState(mode)
    },
    [rightPanelMode],
  )

  /**
   * Opens the right panel in diff mode and optionally focuses a specific file.
   * Passed down through `RunWorkspace` → `MessageStream` → `<EditedFilesCard>`
   * so per-file "Review" buttons jump straight to the matching diff tab.
   */
  const openDiffPanel = useCallback((filePath?: string) => {
    setRightPanelOpenState(true)
    setRightPanelModeState('diff')
    setFocusFilePath(filePath ?? null)
  }, [])

  useEffect(() => {
    setBottomPanelOpen(false)
    setBottomPanelFullscreen(false)
    setBottomPanelInitialTab(null)
    terminalCountRef.current = 0
  }, [selectedProject?.repoPath])

  useEffect(() => {
    setContextPercent(null)
  }, [activeSessionId])

  const handleToggleTerminal = useCallback(() => {
    if (bottomPanelOpen) {
      setBottomPanelOpen(false)
    } else {
      if (!bottomPanelInitialTab && selectedProject?.repoPath) {
        terminalCountRef.current += 1
        const tab = createTerminalTab(
          'shell',
          'Terminal',
          selectedProject.repoPath,
          terminalCountRef.current,
        )
        setBottomPanelInitialTab(tab)
      }
      setBottomPanelOpen(true)
    }
  }, [bottomPanelOpen, bottomPanelInitialTab, selectedProject?.repoPath])

  // Handle Ctrl+; from within WorkspaceView (when it's already mounted).
  useEffect(() => {
    const unsubToggle = window.agentforge.onShortcut('shortcut:toggle-terminal', handleToggleTerminal)
    const unsubFullscreen = window.agentforge.onShortcut(
      'shortcut:toggle-terminal-fullscreen',
      () => setBottomPanelFullscreen((prev) => !prev),
    )
    return () => {
      unsubToggle()
      unsubFullscreen()
    }
  }, [handleToggleTerminal])

  // Open terminal immediately when mounted via keyboard shortcut from settings view.
  useEffect(() => {
    if (!openTerminalOnMount) return
    handleToggleTerminal()
    onTerminalOpened?.()
  }, [openTerminalOnMount]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenCliEditor = useCallback(
    (editor: EditorInfo) => {
      if (!selectedProject?.repoPath) return

      const action = resolveBottomTerminalOpenAction({
        hasPanel: Boolean(bottomPanelInitialTab),
        panelOpen: bottomPanelOpen,
        canAddTab: Boolean(bottomPanelAddTabRef.current),
      })

      if (action === 'show-existing-panel') {
        setBottomPanelOpen(true)
        return
      }

      terminalCountRef.current += 1
      const tab = createTerminalTab(
        editor.id,
        editor.name,
        selectedProject.repoPath,
        terminalCountRef.current,
      )

      if (action === 'add-tab') {
        bottomPanelAddTabRef.current?.(tab)
        return
      }

      setBottomPanelInitialTab(tab)
      setBottomPanelOpen(true)
    },
    [selectedProject?.repoPath, bottomPanelInitialTab, bottomPanelOpen],
  )

  const handleResumeSwarmWithEdit = useCallback(
    async (handoff: string, node: SwarmGraphNode) => {
      if (!selectedProject || !activeThreadId) return

      const prompt = [
        `[Debugger resume from: ${node.role}]`,
        'The previous swarm output was edited by the user. Continue this thread using the edited handoff as the source of truth.',
        '',
        'Edited handoff:',
        handoff,
      ].join('\n')
      const createdAt = Date.now()
      const result = await window.agentforge.agent.dispatch({
        projectId: selectedProject.id,
        threadId: activeThreadId,
        prompt,
        agentId: node.agentLabel,
        modelOverride: node.model,
      })

      onSessionStarted({
        sessionId: result.sessionId,
        threadId: result.threadId,
        prompt,
        routingDecision: null,
        agentId: node.agentLabel === 'cursor' ? undefined : node.agentLabel,
        modelOverride: node.model,
        createdAt,
      })
    },
    [activeThreadId, onSessionStarted, selectedProject],
  )

  const titleForTopBar = activeSession?.prompt?.trim()
    ? activeSession.prompt.trim().slice(0, 80)
    : selectedProject
      ? selectedProject.name
      : 'Workspace'

  return (
    <main className="flex min-w-0 flex-1 overflow-hidden">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
        {selectedProject ? (
          <>
            <WorkspaceTopBar
              title={titleForTopBar}
              model={activeSession?.modelOverride ?? activeSession?.routingDecision?.model}
              rightPanelOpen={rightPanelOpen}
              rightPanelMode={rightPanelMode}
              hasDiff={diffProposals.length > 0}
              hasSwarmGraph={Boolean(activeThreadId)}
              canRerun={Boolean(activeSession?.prompt) && !busy}
              onRerun={onRerunSession}
              onToggleRightPanel={handleToggleRightPanel}
              onFork={activeSessionId ? () => onForkSession(activeSessionId) : undefined}
              onDelete={activeSession?.threadId ? onDeleteThread : undefined}
              reserveTrafficLightInset={isMac}
              onOpenSidebar={onOpenSidebar}
              repoPath={selectedProject?.repoPath}
              onOpenCliEditor={handleOpenCliEditor}
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={onToggleSidebar}
            />

            <div className="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-hairline bg-canvas px-3 py-1.5">
              {MAIN_VIEWS.map((view) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => onMainViewChange(view)}
                  className={`shrink-0 whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium capitalize transition-colors ${
                    mainView === view
                      ? 'bg-white/10 text-primary'
                      : 'text-muted hover:bg-white/5 hover:text-secondary'
                  }`}
                >
                  {view}
                </button>
              ))}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => onSwarmOpenChange(true)}
                className="shrink-0 whitespace-nowrap rounded border border-hairline bg-card px-2 py-1 text-[11px] font-medium text-secondary hover:bg-card-raised hover:text-primary"
              >
                Swarm
              </button>
            </div>

            {bannerError ? (
              <div className="shrink-0 break-words border-b border-accent-del/40 bg-accent-del/10 px-4 py-2 text-xs text-accent-del">
                {bannerError}
              </div>
            ) : null}

            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {mainView === 'workspace' ? (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    {activeSessionId ? (
                      <RunWorkspace
                        project={selectedProject}
                        sessionId={activeSessionId}
                        threadId={activeSession?.threadId ?? null}
                        prompt={activeSession?.prompt ?? ''}
                        imageAttachments={activeSession?.imageAttachments}
                        status={activeSession?.status ?? null}
                        startedAt={activeSession?.createdAt}
                        agentId={activeSession?.agentId ?? activeSession?.routingDecision?.agentId}
                        model={
                          activeSession?.modelOverride ?? activeSession?.routingDecision?.model
                        }
                        modelOverride={
                          activeSession?.modelOverride ?? activeSession?.routingDecision?.model
                        }
                        diffProposals={diffProposals}
                        approvalRequest={approvalRequest}
                        onApprovalRequest={onApprovalRequest}
                        onDiffProposals={onDiffProposals}
                        onStatusChange={onStatusChange}
                        onApproveApproval={onApproveApproval}
                        onRejectApproval={onRejectApproval}
                        onSessionStarted={onSessionStarted}
                        onReviewFile={openDiffPanel}
                        onContextPercent={setContextPercent}
                      />
                    ) : (
                      <div className="flex min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                        <WorkspaceEmpty projectName={selectedProject.name} />
                      </div>
                    )}

                    {activeSession?.threadId ? (
                      <div className="shrink-0 px-3 sm:px-4">
                        <div className="mx-auto w-full max-w-conversation">
                          <QueueBanner
                            messages={pendingQueue}
                            onRemove={onRemoveQueueItem}
                            onClearAll={onClearQueue}
                          />
                        </div>
                      </div>
                    ) : null}

                    <div className="shrink-0 border-t border-hairline px-3 sm:px-4">
                      <div className="mx-auto w-full max-w-conversation">
                        <Composer
                          project={selectedProject}
                          activeThreadId={activeSession?.threadId ?? null}
                          activeSessionId={activeSessionId}
                          activeSessionStatus={activeSession?.status ?? null}
                          busy={busy}
                          busyReason={busyReason}
                          prefillPrompt={prefillPrompt}
                          onCancelSession={onCancelSession}
                          onSessionStarted={onSessionStarted}
                          contextPercent={contextPercent}
                          hasProjectContext={Boolean(selectedProject.context?.trim())}
                          onContextClick={() => setContextDialogOpen(true)}
                          onEnqueue={activeSession?.threadId ? onEnqueue : undefined}
                          onSteer={busy && activeSessionId ? onSteer : undefined}
                        />
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center justify-between border-t border-hairline/50 px-3 py-1">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (bottomPanelOpen && bottomPanelInitialTab) {
                              setBottomPanelOpen(false)
                            } else {
                              handleOpenCliEditor({ id: 'shell', name: 'Terminal', kind: 'cli' })
                            }
                          }}
                          className={`flex h-6 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium transition-colors ${
                            bottomPanelOpen
                              ? 'bg-white/10 text-secondary'
                              : 'text-muted hover:bg-white/5 hover:text-secondary'
                          }`}
                          title="Toggle terminal"
                        >
                          <QuickTerminalIcon />
                          <span>Terminal</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenCliEditor({ id: 'vim', name: 'Vim', kind: 'cli' })}
                          className="flex h-6 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium text-muted transition-colors hover:bg-white/5 hover:text-secondary"
                          title="Open Vim"
                        >
                          <QuickVimIcon />
                          <span>Vim</span>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCommitDialogOpen(true)}
                        className="flex h-6 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium text-muted transition-colors hover:bg-white/5 hover:text-secondary"
                        title="Commit and push all changes"
                      >
                        <QuickCommitIcon />
                        <span>Commit & Push</span>
                      </button>
                    </div>
                  </div>
                ) : mainView === 'costs' ? (
                  <CostDashboard project={selectedProject} />
                ) : (
                  <AutomationManager project={selectedProject} />
                )}

                {bottomPanelInitialTab ? (
                  <BottomTerminalPanel
                    key={bottomPanelInitialTab.id}
                    initialTab={bottomPanelInitialTab}
                    projectId={selectedProject.id}
                    activeThreadId={activeSession?.threadId ?? null}
                    visible={bottomPanelOpen}
                    fullscreen={bottomPanelFullscreen}
                    height={bottomPanelHeight}
                    onHeightChange={setBottomPanelHeight}
                    onFullscreenChange={setBottomPanelFullscreen}
                    onClosePanel={() => {
                      setBottomPanelOpen(false)
                      setBottomPanelFullscreen(false)
                    }}
                    onEmpty={() => {
                      setBottomPanelFullscreen(false)
                      setBottomPanelOpen(false)
                      setBottomPanelInitialTab(null)
                      terminalCountRef.current = 0
                    }}
                    onNewTerminal={() => {
                      if (!selectedProject?.repoPath) return
                      terminalCountRef.current += 1
                      const tab = createTerminalTab(
                        'shell',
                        'Terminal',
                        selectedProject.repoPath,
                        terminalCountRef.current,
                      )
                      bottomPanelAddTabRef.current?.(tab)
                    }}
                    addTabRef={bottomPanelAddTabRef}
                    onSessionStarted={onSessionStarted}
                    onRemediationError={onBannerError}
                  />
                ) : null}
              </div>

              {mainView === 'workspace' && rightPanelMounted ? (
                <aside
                  data-motion="panel-right"
                  data-state={rightPanelOpen ? 'open' : 'closed'}
                  className={
                    rightPanelFullscreen
                      ? RIGHT_PANEL_FULLSCREEN_CLASS
                      : RIGHT_PANEL_DOCKED_CLASS
                  }
                  onAnimationEnd={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (!rightPanelOpen) setRightPanelMounted(false)
                  }}
                >
                  <div className="flex h-9 shrink-0 items-center gap-1 border-b border-hairline px-2">
                    <RightPanelTab
                      label="Diff"
                      active={rightPanelMode === 'diff'}
                      disabled={diffProposals.length === 0}
                      onClick={() => setRightPanelModeState('diff')}
                    />
                    <RightPanelTab
                      label="Terminal"
                      active={rightPanelMode === 'terminal'}
                      onClick={() => setRightPanelModeState('terminal')}
                    />
                    <RightPanelTab
                      label="Swarm"
                      active={rightPanelMode === 'swarm'}
                      disabled={!activeThreadId}
                      onClick={() => setRightPanelModeState('swarm')}
                    />
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => setRightPanelFullscreen((value) => !value)}
                      aria-label={rightPanelFullscreen ? 'Exit full screen' : 'Full screen panel'}
                      title={rightPanelFullscreen ? 'Exit full screen' : 'Full screen'}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-white/5 hover:text-primary"
                    >
                      {rightPanelFullscreen ? iconMinimize : iconMaximize}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRightPanelFullscreen(false)
                        setRightPanelOpenState(false)
                      }}
                      aria-label="Close panel"
                      className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-white/5 hover:text-primary"
                    >
                      ×
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-hidden">
                    {rightPanelMode === 'diff' && diffProposals.length > 0 ? (
                      <DiffViewer
                        proposals={diffProposals}
                        focusFilePath={focusFilePath}
                      />
                    ) : rightPanelMode === 'diff' ? (
                      <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-muted">
                        No code changes to review.
                      </div>
                    ) : rightPanelMode === 'swarm' ? (
                      <SwarmGraphPanel
                        project={selectedProject}
                        threadId={activeThreadId}
                        activeSessionId={activeSessionId}
                        activeSessionStatus={activeSession?.status ?? null}
                        onPauseSession={onCancelSession}
                        onResumeWithEdit={handleResumeSwarmWithEdit}
                      />
                    ) : (
                      <TerminalPanel
                        sessionId={activeSessionId}
                        diffProposals={[]}
                        approvalRequest={approvalRequest}
                        onDiffProposals={handleActiveDiffProposals}
                        onApprovalRequest={onApprovalRequest}
                        onStatusChange={onStatusChange}
                        onApproveApproval={onApproveApproval}
                        onRejectApproval={onRejectApproval}
                      />
                    )}
                  </div>
                </aside>
              ) : null}
            </div>

            <SwarmBuilder
              open={swarmOpen}
              projectId={selectedProject.id}
              threadId={activeSession?.threadId ?? null}
              initialPrompt={activeSession?.prompt ?? prefillPrompt ?? ''}
              onClose={() => onSwarmOpenChange(false)}
              onSwarmStarted={(_swarmId, result) => onSwarmStarted(result)}
            />
            <ProjectContextDialog
              project={selectedProject}
              open={contextDialogOpen}
              onOpenChange={setContextDialogOpen}
              onSaved={(project) => onProjectUpdated?.(project)}
            />
            <CommitAndPushDialog
              project={selectedProject}
              open={commitDialogOpen}
              onOpenChange={setCommitDialogOpen}
            />
          </>
        ) : (
          <>
            <WorkspacePlaceholderTopBar
              isMac={isMac}
              onOpenSidebar={onOpenSidebar}
            />
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto overflow-x-hidden p-6">
              <div className="max-w-sm text-center">
                <div className="text-[15px] font-semibold text-primary">Select a project</div>
                <p className="mt-2 text-[13px] leading-6 text-muted">
                  Choose a repository from the sidebar or add one with the plus button.
                </p>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  )
}

function WorkspacePlaceholderTopBar({
  isMac,
  onOpenSidebar,
}: {
  isMac: boolean
  onOpenSidebar?: () => void
}) {
  const leftInsetClass = isMac ? 'pl-[70px] md:pl-4' : 'pl-2 md:pl-4'

  return (
    <div
      className={`drag flex h-11 shrink-0 items-center border-b border-hairline bg-canvas ${leftInsetClass} pr-2`}
    >
      {onOpenSidebar ? (
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
          className="no-drag flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-white/5 hover:text-primary md:hidden"
        >
          <MenuIcon />
        </button>
      ) : null}
    </div>
  )
}

function RightPanelTab({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const stateClasses = disabled
    ? 'cursor-not-allowed text-muted/40'
    : active
      ? 'bg-white/10 text-primary'
      : 'text-secondary hover:bg-white/5 hover:text-primary'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${stateClasses}`}
    >
      {label}
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

const iconMaximize = (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M5.5 2.5h-3v3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2.5 2.5 6 6" strokeLinecap="round" />
    <path d="M10.5 2.5h3v3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13.5 2.5 10 6" strokeLinecap="round" />
    <path d="M5.5 13.5h-3v-3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2.5 13.5 6 10" strokeLinecap="round" />
    <path d="M10.5 13.5h3v-3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13.5 13.5 10 10" strokeLinecap="round" />
  </svg>
)

const iconMinimize = (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M6 2.5v3.5H2.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2.5 6 6 2.5" strokeLinecap="round" />
    <path d="M10 2.5v3.5h3.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13.5 6 10 2.5" strokeLinecap="round" />
    <path d="M6 13.5V10H2.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2.5 10 6 13.5" strokeLinecap="round" />
    <path d="M10 13.5V10h3.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13.5 10 10 13.5" strokeLinecap="round" />
  </svg>
)

function QuickTerminalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

function QuickVimIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2L22 12L12 22L2 12Z" />
      <path d="M9 10L12 14.5L15 10" />
    </svg>
  )
}

function QuickCommitIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <line x1="3" y1="12" x2="9" y2="12" />
      <line x1="15" y1="12" x2="21" y2="12" />
      <path d="M17 6l4 6-4 6" />
    </svg>
  )
}
