import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type {
  ApprovalRequest,
  DiffProposal,
  Project,
  SessionStatus,
} from '../../../../shared/types'
import { DiffViewer } from '../../../components/DiffViewer'
import { AutomationManager } from '../../automations'
import { CostDashboard } from '../../costs'
import {
  SessionHeader,
  TerminalPanel,
  type ActiveSessionMeta,
  type StartedSessionSummary,
} from '../../sessions'
import { SwarmBuilder } from '../../swarms'
import { Composer } from '../components/Composer'
import { ProjectContextDialog } from '../components/ProjectContextDialog'
import { WorkspaceEmpty } from '../components/WorkspaceEmpty'
import { WorkspaceTopBar, type RightPanelMode } from '../components/WorkspaceTopBar'
import type { MainView } from '../hooks/useWorkspaceController'
import { RunWorkspace } from './RunWorkspace'

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
  onDiffProposals: (proposals: DiffProposal[]) => void
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
}

const MAIN_VIEWS: MainView[] = ['workspace', 'costs', 'automations']

const RIGHT_PANEL_OPEN_KEY = 'workspace.rightPanelOpen'
const RIGHT_PANEL_MODE_KEY = 'workspace.rightPanelMode'

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function readPanelOpen(): boolean {
  const ls = safeStorage()
  if (!ls) return false
  return ls.getItem(RIGHT_PANEL_OPEN_KEY) === '1'
}

function readPanelMode(): RightPanelMode {
  const ls = safeStorage()
  const value = ls?.getItem(RIGHT_PANEL_MODE_KEY)
  return value === 'terminal' ? 'terminal' : 'diff'
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
}: WorkspaceViewProps) {
  const [rightPanelOpen, setRightPanelOpenState] = useState<boolean>(() => readPanelOpen())
  const [rightPanelMounted, setRightPanelMounted] = useState<boolean>(() => readPanelOpen())
  const [rightPanelMode, setRightPanelModeState] = useState<RightPanelMode>(() => readPanelMode())
  const [rightPanelFullscreen, setRightPanelFullscreen] = useState(false)
  const [contextDialogOpen, setContextDialogOpen] = useState(false)
  /** File path requested via the "Review" button — focused inside <DiffViewer>. */
  const [focusFilePath, setFocusFilePath] = useState<string | null>(null)

  // Keep the right panel mounted while opening, and during the close animation
  // so `data-state="closed"` exit keyframes can play before unmount.
  useEffect(() => {
    if (rightPanelOpen) setRightPanelMounted(true)
  }, [rightPanelOpen])

  // Persist panel state.
  useEffect(() => {
    const ls = safeStorage()
    if (!ls) return
    if (rightPanelOpen) ls.setItem(RIGHT_PANEL_OPEN_KEY, '1')
    else ls.removeItem(RIGHT_PANEL_OPEN_KEY)
  }, [rightPanelOpen])

  useEffect(() => {
    const ls = safeStorage()
    if (!ls) return
    ls.setItem(RIGHT_PANEL_MODE_KEY, rightPanelMode)
  }, [rightPanelMode])

  // If diff disappears while diff is selected, fall back to terminal.
  useEffect(() => {
    if (rightPanelMode === 'diff' && diffProposals.length === 0 && rightPanelOpen) {
      setRightPanelModeState('terminal')
    }
  }, [diffProposals.length, rightPanelMode, rightPanelOpen])

  // Auto-open the right panel the first time diffs land in a session.
  useEffect(() => {
    if (diffProposals.length > 0 && !rightPanelOpen) {
      setRightPanelOpenState(true)
      setRightPanelModeState('diff')
    }
    // Only react to diff appearance, not panel state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffProposals.length > 0])

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
              canRerun={Boolean(activeSession?.prompt) && !busy}
              onRerun={onRerunSession}
              onToggleRightPanel={handleToggleRightPanel}
              onFork={activeSessionId ? () => onForkSession(activeSessionId) : undefined}
              onDelete={activeSession?.threadId ? onDeleteThread : undefined}
              reserveTrafficLightInset={isMac}
              onOpenSidebar={onOpenSidebar}
            />

            <div className="flex min-h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-hairline bg-canvas px-3 py-1.5">
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
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {mainView === 'workspace' ? (
                  <>
                    {activeSessionId ? (
                      <div className="shrink-0 border-b border-hairline px-3 sm:px-4">
                        <div className="mx-auto w-full max-w-[820px]">
                          <SessionHeader
                            project={selectedProject}
                            sessionId={activeSessionId}
                            prompt={activeSession?.prompt ?? ''}
                            status={activeSession?.status ?? null}
                            routingDecision={activeSession?.routingDecision ?? null}
                            modelOverride={activeSession?.modelOverride}
                            onCancel={onCancelSession}
                            onFork={onForkSession}
                            onFeedback={onFeedback}
                          />
                        </div>
                      </div>
                    ) : null}

                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                      {activeSessionId ? (
                        <RunWorkspace
                          project={selectedProject}
                          sessionId={activeSessionId}
                          threadId={activeSession?.threadId ?? null}
                          prompt={activeSession?.prompt ?? ''}
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
                        />
                      ) : (
                        <div className="flex min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                          <WorkspaceEmpty projectName={selectedProject.name} />
                        </div>
                      )}

                      <div className="shrink-0 border-t border-hairline px-3 sm:px-4">
                        <div className="mx-auto w-full max-w-[820px]">
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
                            hasProjectContext={Boolean(selectedProject.context?.trim())}
                            onContextClick={() => setContextDialogOpen(true)}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                ) : mainView === 'costs' ? (
                  <CostDashboard project={selectedProject} />
                ) : (
                  <AutomationManager project={selectedProject} />
                )}
              </div>

              {mainView === 'workspace' && rightPanelMounted ? (
                <aside
                  data-motion="panel-right"
                  data-state={rightPanelOpen ? 'open' : 'closed'}
                  className={
                    rightPanelFullscreen
                      ? 'absolute inset-0 z-50 flex min-w-0 flex-col border-l border-hairline bg-canvas shadow-2xl shadow-black/50'
                      : 'absolute inset-y-0 right-0 z-30 flex w-full min-w-0 flex-col border-l border-hairline bg-canvas shadow-2xl shadow-black/40 sm:w-[420px] xl:relative xl:inset-auto xl:z-auto xl:w-[420px] xl:min-w-[320px] xl:max-w-[720px] xl:shrink-0 xl:shadow-none 2xl:w-[520px]'
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
                    ) : (
                      <TerminalPanel
                        sessionId={activeSessionId}
                        diffProposals={[]}
                        approvalRequest={approvalRequest}
                        onDiffProposals={onDiffProposals}
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
