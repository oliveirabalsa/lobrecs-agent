import { ProjectSidebar } from '../modules/projects'
import { useWorkspaceController } from '../modules/workspace'
import { WorkspaceView } from '../modules/workspace/views/WorkspaceView'

export function RendererApp() {
  const workspace = useWorkspaceController()

  return (
    <div className="flex h-screen min-w-[320px] overflow-hidden bg-zinc-950 text-zinc-100">
      <ProjectSidebar
        selectedProjectId={workspace.selectedProject?.id ?? null}
        onSelect={workspace.handleProjectSelect}
        onSelectedProjectDeleted={workspace.handleSelectedProjectDeleted}
      />

      <WorkspaceView
        selectedProject={workspace.selectedProject}
        activeSession={workspace.activeSession}
        activeSessionId={workspace.activeSessionId}
        tabs={workspace.tabs.tabs}
        activeTabId={workspace.tabs.activeTabId}
        mainView={workspace.mainView}
        swarmOpen={workspace.swarmOpen}
        diffProposals={workspace.diffProposals}
        approvalRequest={workspace.approvalRequest}
        prefillPrompt={workspace.prefillPrompt}
        bannerError={workspace.bannerError}
        busy={workspace.isBusy || workspace.diffProposals.length > 0 || Boolean(workspace.approvalRequest)}
        busyReason={workspace.busyReason}
        onMainViewChange={workspace.setMainView}
        onSwarmOpenChange={workspace.setSwarmOpen}
        onSelectTab={(sessionId) => void workspace.handleSelectTab(sessionId)}
        onCloseTab={(sessionId) => void workspace.handleCloseTab(sessionId)}
        onNewTab={workspace.handleNewTab}
        onCancelSession={(sessionId) => void workspace.handleCancelSession(sessionId)}
        onForkSession={(sessionId) => void workspace.handleForkSession(sessionId)}
        onFeedback={(sessionId, outcome, note) =>
          void workspace.handleFeedback(sessionId, outcome, note)
        }
        onDiffProposals={workspace.setDiffProposals}
        onApprovalRequest={workspace.handleApprovalRequest}
        onStatusChange={workspace.updateActiveStatus}
        onApproveApproval={() => void workspace.handleApproveApproval()}
        onRejectApproval={() => void workspace.handleRejectApproval()}
        onApproveDiff={(filePath) => void workspace.handleApproveDiff(filePath)}
        onRejectDiff={(filePath) => void workspace.handleRejectDiff(filePath)}
        onEditAndApproveDiff={(filePath, newContent) =>
          void workspace.handleApplyDiff(filePath, newContent)
        }
        onSessionStarted={workspace.handleSessionStarted}
        onSwarmStarted={workspace.handleSwarmStarted}
        onOpenSession={workspace.handleOpenSession}
      />
    </div>
  )
}
