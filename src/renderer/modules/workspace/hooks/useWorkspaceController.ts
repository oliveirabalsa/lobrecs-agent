import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ApprovalRequest,
  DiffProposal,
  Project,
  Session,
  SessionStatus,
} from '../../../../shared/types'
import {
  isSessionStatus,
  removeProposal,
  useTabs,
  type ActiveSessionMeta,
  type StartedSessionSummary,
} from '../../sessions'

export type MainView = 'workspace' | 'costs' | 'automations'

export function useWorkspaceController() {
  const tabs = useTabs()
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [activeSession, setActiveSession] = useState<ActiveSessionMeta | null>(null)
  const [diffProposals, setDiffProposals] = useState<DiffProposal[]>([])
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null)
  const [prefillPrompt, setPrefillPrompt] = useState<string | undefined>(undefined)
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [mainView, setMainView] = useState<MainView>('workspace')
  const [swarmOpen, setSwarmOpen] = useState(false)

  const activeSessionId = activeSession?.id ?? null

  useEffect(() => {
    const unsubscribeSwarm = window.agentforge.onShortcut('shortcut:swarm', () => {
      if (selectedProject) {
        setSwarmOpen(true)
      }
    })
    const unsubscribeKillAll = window.agentforge.onShortcut('shortcut:kill-all', () => {
      void window.agentforge.agent.killAll()
      setActiveSession((current) => (current ? { ...current, status: 'cancelled' } : current))
      tabs.tabs.forEach((tab) => {
        if (tab.status === 'running' || tab.status === 'awaiting-approval') {
          tabs.updateStatus(tab.sessionId, 'cancelled')
        }
      })
    })

    return () => {
      unsubscribeSwarm()
      unsubscribeKillAll()
    }
  }, [selectedProject, tabs])

  const isBusy = useMemo(() => {
    if (!activeSession) return false
    return activeSession.status === 'running' || activeSession.status === 'awaiting-approval'
  }, [activeSession])

  const busyReason = useMemo(() => {
    if (diffProposals.length > 0) return 'Resolve the pending diff before starting another task'
    if (approvalRequest) return 'Respond to the pending approval before starting another task'
    if (isBusy) return 'Current session is still running'
    return undefined
  }, [approvalRequest, diffProposals.length, isBusy])

  function handleSelectedProjectDeleted() {
    setSelectedProject(null)
    setActiveSession(null)
    setDiffProposals([])
    setApprovalRequest(null)
  }

  function handleProjectSelect(project: Project) {
    setSelectedProject(project)
    setActiveSession(null)
    tabs.resetTabs()
    setDiffProposals([])
    setApprovalRequest(null)
    setBannerError(null)
    setMainView('workspace')
  }

  function handleSessionStarted(summary: StartedSessionSummary) {
    setActiveSession({
      id: summary.sessionId,
      prompt: summary.prompt,
      status: 'running',
      routingDecision: summary.routingDecision,
      agentId: summary.agentId,
      modelOverride: summary.modelOverride,
    })
    setDiffProposals([])
    setApprovalRequest(null)
    setBannerError(null)
    tabs.addTab({
      sessionId: summary.sessionId,
      projectId: selectedProject?.id ?? '',
      prompt: summary.prompt,
      status: 'running',
      model: summary.modelOverride
        ? `${summary.agentId ?? 'agent'} / ${summary.modelOverride}`
        : summary.routingDecision?.model ?? 'auto',
      tier: summary.routingDecision?.tier ?? 'balanced',
      createdAt: Date.now(),
    })
  }

  const updateActiveStatus = useCallback(
    (status: SessionStatus) => {
      setActiveSession((current) => (current ? { ...current, status } : current))
      if (activeSessionId) {
        tabs.updateStatus(activeSessionId, status)
      }
    },
    [activeSessionId, tabs],
  )

  const handleApprovalRequest = useCallback((request: ApprovalRequest | null) => {
    setApprovalRequest(request)
  }, [])

  async function handleApproveApproval() {
    if (!activeSessionId) return

    try {
      await window.agentforge.agent.approve(activeSessionId)
      setApprovalRequest(null)
      updateActiveStatus('running')
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to approve request')
    }
  }

  async function handleRejectApproval() {
    if (!activeSessionId) return

    try {
      await window.agentforge.agent.reject(activeSessionId)
      setApprovalRequest(null)
      updateActiveStatus('running')
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to reject request')
    }
  }

  async function handleApproveDiff(filePath: string) {
    const proposal = diffProposals.find((item) => item.filePath === filePath)
    if (!proposal) return

    await handleApplyDiff(filePath, proposal.proposedContent)
  }

  async function handleApplyDiff(filePath: string, content: string) {
    const proposal = diffProposals.find((item) => item.filePath === filePath)

    try {
      await window.agentforge.diff.apply(filePath, content, proposal?.originalContent)
      if (activeSessionId) {
        await window.agentforge.agent.approve(activeSessionId)
      }
      setDiffProposals((current) => removeProposal(current, filePath))
      setBannerError(null)
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to apply diff')
    }
  }

  async function handleRejectDiff(filePath: string) {
    try {
      await window.agentforge.diff.reject()
      if (activeSessionId) {
        await window.agentforge.agent.reject(activeSessionId)
      }
      setDiffProposals((current) => removeProposal(current, filePath))
      setBannerError(null)
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to reject diff')
    }
  }

  async function handleCancelSession(sessionId: string) {
    try {
      await window.agentforge.agent.cancel(sessionId)
      updateActiveStatus('cancelled')
      tabs.updateStatus(sessionId, 'cancelled')
      setApprovalRequest(null)
      setDiffProposals([])
      setBannerError(null)
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to cancel session')
    }
  }

  async function handleForkSession(sessionId: string) {
    try {
      const fork = await window.agentforge.sessions.fork(sessionId)
      if (fork?.prompt) {
        setPrefillPrompt(fork.prompt)
      }
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to fork session')
    }
  }

  function handleOpenSession(session: Session) {
    setActiveSession({
      id: session.id,
      prompt: session.prompt,
      status: session.status,
      routingDecision: null,
      agentId: session.agentId,
      modelOverride: session.model,
    })
    tabs.addTab({
      sessionId: session.id,
      projectId: session.projectId,
      prompt: session.prompt,
      status: session.status,
      model: session.model,
      tier: selectedProject?.modelTier ?? 'balanced',
      createdAt: session.createdAt,
    })
    setMainView('workspace')
    setDiffProposals([])
    setApprovalRequest(null)
    setBannerError(null)
  }

  async function handleCloseTab(sessionId: string) {
    const tab = tabs.tabs.find((item) => item.sessionId === sessionId)
    if (tab?.status === 'running' || tab?.status === 'awaiting-approval') {
      await window.agentforge.agent.cancel(sessionId).catch(() => undefined)
      tabs.updateStatus(sessionId, 'cancelled')
    }

    tabs.closeTab(sessionId)
    if (activeSession?.id === sessionId) {
      setActiveSession(null)
      setDiffProposals([])
      setApprovalRequest(null)
    }
  }

  async function handleSelectTab(sessionId: string) {
    tabs.setActive(sessionId)
    const session = await window.agentforge.sessions.get(sessionId).catch(() => null)
    if (session) {
      handleOpenSession(session)
    }
  }

  function handleSwarmStarted(result: {
    swarmId: string
    sessions: Array<{
      sessionId: string
      role: string
      status: string
      agentId?: Project['agentId']
      model?: string
    }>
  }) {
    for (const session of result.sessions) {
      tabs.addTab({
        sessionId: session.sessionId,
        projectId: selectedProject?.id ?? '',
        prompt: `[${session.role}] swarm ${result.swarmId.slice(0, 8)}`,
        status: isSessionStatus(session.status) ? session.status : 'running',
        model: session.model
          ? `${session.agentId ?? 'agent'} / ${session.model}`
          : 'swarm',
        tier: 'balanced',
        createdAt: Date.now(),
      })
    }

    const first = result.sessions[0]
    if (first) {
      setActiveSession({
        id: first.sessionId,
        prompt: `[${first.role}] swarm`,
        status: isSessionStatus(first.status) ? first.status : 'running',
        routingDecision: null,
        agentId: first.agentId,
        modelOverride: first.model ?? 'swarm',
      })
      setMainView('workspace')
    }
  }

  async function handleFeedback(
    sessionId: string,
    outcome: 'success' | 'failure' | 'partial',
    note?: string,
  ) {
    try {
      await window.agentforge.feedback.save(sessionId, outcome, note)
      setBannerError(null)
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to save feedback')
    }
  }

  function handleNewTab() {
    setMainView('workspace')
    setActiveSession(null)
  }

  return {
    tabs,
    selectedProject,
    activeSession,
    activeSessionId,
    diffProposals,
    approvalRequest,
    prefillPrompt,
    bannerError,
    mainView,
    swarmOpen,
    isBusy,
    busyReason,
    setDiffProposals,
    setMainView,
    setSwarmOpen,
    handleSelectedProjectDeleted,
    handleProjectSelect,
    handleSessionStarted,
    updateActiveStatus,
    handleApprovalRequest,
    handleApproveApproval,
    handleRejectApproval,
    handleApproveDiff,
    handleApplyDiff,
    handleRejectDiff,
    handleCancelSession,
    handleForkSession,
    handleOpenSession,
    handleCloseTab,
    handleSelectTab,
    handleSwarmStarted,
    handleFeedback,
    handleNewTab,
  }
}
