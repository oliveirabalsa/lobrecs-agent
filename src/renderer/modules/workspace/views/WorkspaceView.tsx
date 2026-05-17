import type { Dispatch, SetStateAction } from 'react'
import type {
  ApprovalRequest,
  DiffProposal,
  Project,
  Session,
  SessionStatus,
} from '../../../../shared/types'
import { AutomationManager } from '../../automations'
import { CostDashboard } from '../../costs'
import {
  HistoryPanel,
  SessionHeader,
  TabBar,
  type ActiveSessionMeta,
  type StartedSessionSummary,
  type Tab,
} from '../../sessions'
import { SwarmBuilder } from '../../swarms'
import type { MainView } from '../hooks/useWorkspaceController'
import { RunWorkspace } from './RunWorkspace'

interface WorkspaceViewProps {
  selectedProject: Project | null
  activeSession: ActiveSessionMeta | null
  activeSessionId: string | null
  tabs: Tab[]
  activeTabId: string | null
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
  onSelectTab: (sessionId: string) => void
  onCloseTab: (sessionId: string) => void
  onNewTab: () => void
  onCancelSession: (sessionId: string) => void
  onForkSession: (sessionId: string) => void
  onFeedback: (
    sessionId: string,
    outcome: 'success' | 'failure' | 'partial',
    note?: string,
  ) => void
  onDiffProposals: (proposals: DiffProposal[]) => void
  onApprovalRequest: (request: ApprovalRequest | null) => void
  onStatusChange: (status: SessionStatus) => void
  onApproveApproval: () => void
  onRejectApproval: () => void
  onApproveDiff: (filePath: string) => void
  onRejectDiff: (filePath: string) => void
  onEditAndApproveDiff: (filePath: string, newContent: string) => void
  onSessionStarted: (session: StartedSessionSummary) => void
  onSwarmStarted: (result: {
    swarmId: string
    sessions: Array<{
      sessionId: string
      role: string
      status: string
      agentId?: Project['agentId']
      model?: string
    }>
  }) => void
  onOpenSession: (session: Session) => void
}

const MAIN_VIEWS: MainView[] = ['workspace', 'costs', 'automations']

export function WorkspaceView({
  selectedProject,
  activeSession,
  activeSessionId,
  tabs,
  activeTabId,
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
  onSelectTab,
  onCloseTab,
  onNewTab,
  onCancelSession,
  onForkSession,
  onFeedback,
  onDiffProposals,
  onApprovalRequest,
  onStatusChange,
  onApproveApproval,
  onRejectApproval,
  onApproveDiff,
  onRejectDiff,
  onEditAndApproveDiff,
  onSessionStarted,
  onSwarmStarted,
  onOpenSession,
}: WorkspaceViewProps) {
  return (
    <main className="flex min-w-0 flex-1 overflow-hidden">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selectedProject ? (
          <>
            <div className="flex h-11 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3">
              <div className="flex items-center gap-1">
                {MAIN_VIEWS.map((view) => (
                  <button
                    key={view}
                    type="button"
                    onClick={() => onMainViewChange(view)}
                    className={`rounded px-3 py-1.5 text-xs font-medium capitalize ${
                      mainView === view
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
                    }`}
                  >
                    {view}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onSwarmOpenChange(true)}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Swarm
              </button>
            </div>

            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelect={onSelectTab}
              onClose={onCloseTab}
              onNewTab={onNewTab}
            />

            {mainView === 'workspace' ? (
              <>
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

                {bannerError ? (
                  <div className="border-b border-red-900/70 bg-red-950/50 px-4 py-2 text-xs text-red-200">
                    {bannerError}
                  </div>
                ) : null}

                <RunWorkspace
                  project={selectedProject}
                  sessionId={activeSessionId}
                  prompt={activeSession?.prompt ?? ''}
                  status={activeSession?.status ?? null}
                  model={activeSession?.modelOverride ?? activeSession?.routingDecision?.model}
                  diffProposals={diffProposals}
                  approvalRequest={approvalRequest}
                  prefillPrompt={prefillPrompt}
                  busy={busy}
                  busyReason={busyReason}
                  onDiffProposals={onDiffProposals}
                  onApprovalRequest={onApprovalRequest}
                  onStatusChange={onStatusChange}
                  onApproveApproval={onApproveApproval}
                  onRejectApproval={onRejectApproval}
                  onApproveDiff={onApproveDiff}
                  onRejectDiff={onRejectDiff}
                  onEditAndApproveDiff={onEditAndApproveDiff}
                  onSessionStarted={onSessionStarted}
                />
              </>
            ) : mainView === 'costs' ? (
              <CostDashboard project={selectedProject} />
            ) : (
              <AutomationManager project={selectedProject} />
            )}

            <SwarmBuilder
              open={swarmOpen}
              projectId={selectedProject.id}
              initialPrompt={activeSession?.prompt ?? prefillPrompt ?? ''}
              onClose={() => onSwarmOpenChange(false)}
              onSwarmStarted={(_swarmId, result) => onSwarmStarted(result)}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-sm text-center">
              <div className="text-base font-semibold text-zinc-200">Select a project</div>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Choose a repository from the sidebar or add one with the plus button.
              </p>
            </div>
          </div>
        )}
      </section>

      {selectedProject ? (
        <HistoryPanel
          projectId={selectedProject.id}
          activeSessionId={activeSessionId}
          onOpenSession={onOpenSession}
          onFork={onForkSession}
        />
      ) : null}
    </main>
  )
}
