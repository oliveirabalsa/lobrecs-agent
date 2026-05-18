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
  useTabs,
  type ActiveSessionMeta,
  type StartedSessionSummary,
} from '../../sessions'

export type MainView = 'workspace' | 'costs' | 'automations'

const ACTIVE_THREAD_KEY_PREFIX = 'activeThread:'

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function readActiveThread(projectId: string): string | null {
  const ls = safeLocalStorage()
  if (!ls) return null
  return ls.getItem(`${ACTIVE_THREAD_KEY_PREFIX}${projectId}`)
}

function writeActiveThread(projectId: string, threadId: string | null): void {
  const ls = safeLocalStorage()
  if (!ls) return
  const key = `${ACTIVE_THREAD_KEY_PREFIX}${projectId}`
  if (threadId) ls.setItem(key, threadId)
  else ls.removeItem(key)
}

function toStartedSessionAgentId(
  agentId: Project['agentId'] | undefined,
): StartedSessionSummary['agentId'] {
  if (agentId === 'claude-code' || agentId === 'codex' || agentId === 'opencode') {
    return agentId
  }
  return undefined
}

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
  const activeThreadId = activeSession?.threadId ?? null

  const clearActiveThread = useCallback(
    (projectId?: string) => {
      const targetProjectId = projectId ?? selectedProject?.id
      if (targetProjectId) writeActiveThread(targetProjectId, null)
      setActiveSession(null)
      setDiffProposals([])
      setApprovalRequest(null)
      setBannerError(null)
    },
    [selectedProject?.id],
  )

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

  useEffect(() => {
    const unsubscribe = window.agentforge.threads.onDeleted((event) => {
      if (readActiveThread(event.projectId) === event.threadId) {
        writeActiveThread(event.projectId, null)
      }
      if (activeThreadId !== event.threadId) return
      clearActiveThread(event.projectId)
    })

    return unsubscribe
  }, [activeThreadId, clearActiveThread])

  const isBusy = useMemo(() => {
    if (!activeSession) return false
    return activeSession.status === 'running' || activeSession.status === 'awaiting-approval'
  }, [activeSession])

  const busyReason = useMemo(() => {
    if (approvalRequest) return 'Respond to the pending approval before starting another task'
    if (isBusy) return 'Current session is still running'
    return undefined
  }, [approvalRequest, isBusy])

  function handleSelectedProjectDeleted() {
    setSelectedProject(null)
    clearActiveThread()
  }

  function handleProjectSelect(project: Project) {
    setSelectedProject(project)
    setActiveSession(null)
    tabs.resetTabs()
    setDiffProposals([])
    setApprovalRequest(null)
    setBannerError(null)
    setMainView('workspace')

    // Restore the previously active thread for this project, if any.
    const restoredId = readActiveThread(project.id)
    if (!restoredId) return
    void window.agentforge.threads
      .get(restoredId)
      .then(async (thread) => {
        if (!thread || thread.projectId !== project.id || !thread.lastSessionId) {
          writeActiveThread(project.id, null)
          return
        }
        const session = await window.agentforge.sessions.get(thread.lastSessionId)
        if (!session || session.projectId !== project.id) {
          writeActiveThread(project.id, null)
          return
        }
        handleOpenSession(session, project)
      })
      .catch(() => {
        writeActiveThread(project.id, null)
      })
  }

  function handleSessionStarted(summary: StartedSessionSummary) {
    setActiveSession({
      id: summary.sessionId,
      threadId: summary.threadId,
      prompt: summary.prompt,
      status: 'running',
      routingDecision: summary.routingDecision,
      agentId: summary.agentId,
      modelOverride: summary.modelOverride,
      createdAt: summary.createdAt ?? Date.now(),
    })
    setDiffProposals([])
    setApprovalRequest(null)
    setBannerError(null)
    if (selectedProject) writeActiveThread(selectedProject.id, summary.threadId)
    tabs.addTab({
      sessionId: summary.sessionId,
      projectId: selectedProject?.id ?? '',
      prompt: summary.prompt,
      status: 'running',
      model: summary.modelOverride
        ? `${summary.agentId ?? 'agent'} / ${summary.modelOverride}`
        : summary.routingDecision?.model ?? 'auto',
      tier: summary.routingDecision?.tier ?? 'balanced',
      createdAt: summary.createdAt ?? Date.now(),
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

  const handleApprovalRequest = useCallback(
    (request: ApprovalRequest | null) => {
      setApprovalRequest(request)
    },
    [],
  )

  const handleDiffProposals = useCallback(
    (proposals: DiffProposal[]) => {
      setDiffProposals(proposals)
    },
    [],
  )

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

  async function handleRerunActiveSession(): Promise<StartedSessionSummary | null> {
    const prompt = activeSession?.prompt.trim()
    if (!selectedProject || !activeSession || !prompt) return null
    if (isBusy || approvalRequest) return null

    try {
      const createdAt = Date.now()
      const result = await window.agentforge.agent.dispatch({
        projectId: selectedProject.id,
        prompt,
        agentId: activeSession.agentId,
        modelOverride: activeSession.modelOverride,
        threadId: activeSession.threadId,
      })
      const summary: StartedSessionSummary = {
        sessionId: result.sessionId,
        threadId: result.threadId,
        prompt,
        routingDecision: null,
        agentId: toStartedSessionAgentId(activeSession.agentId),
        modelOverride: activeSession.modelOverride,
        createdAt,
      }
      handleSessionStarted(summary)
      return summary
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to rerun session')
      return null
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

  async function handleDeleteActiveThread() {
    const threadId = activeSession?.threadId
    if (!threadId) return

    try {
      if (activeSessionId && isBusy) {
        await window.agentforge.agent.cancel(activeSessionId).catch(() => undefined)
      }
      await window.agentforge.threads.delete(threadId)
      clearActiveThread(selectedProject?.id)
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to delete thread')
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

  function handleOpenSession(session: Session, project?: Project) {
    if (project && selectedProject?.id !== project.id) {
      setSelectedProject(project)
      tabs.resetTabs()
    }

    setActiveSession({
      id: session.id,
      threadId: session.threadId,
      prompt: session.prompt,
      status: session.status,
      routingDecision: null,
      agentId: session.agentId,
      modelOverride: session.model,
      createdAt: session.createdAt,
    })
    writeActiveThread(session.projectId, session.threadId ?? null)
    tabs.addTab({
      sessionId: session.id,
      projectId: session.projectId,
      prompt: session.prompt,
      status: session.status,
      model: session.model,
      tier: project?.modelTier ?? selectedProject?.modelTier ?? 'balanced',
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
      if (selectedProject) writeActiveThread(selectedProject.id, null)
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
      threadId?: string
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
        threadId: first.threadId,
        prompt: `[${first.role}] swarm`,
        status: isSessionStatus(first.status) ? first.status : 'running',
        routingDecision: null,
        agentId: first.agentId,
        modelOverride: first.model ?? 'swarm',
        createdAt: Date.now(),
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
    clearActiveThread()
  }

  return {
    tabs,
    selectedProject,
    activeSession,
    activeSessionId,
    activeThreadId,
    diffProposals,
    approvalRequest,
    prefillPrompt,
    bannerError,
    mainView,
    swarmOpen,
    isBusy,
    busyReason,
    setDiffProposals,
    handleDiffProposals,
    setMainView,
    setSwarmOpen,
    handleSelectedProjectDeleted,
    handleProjectSelect,
    handleSessionStarted,
    updateActiveStatus,
    handleApprovalRequest,
    handleApproveApproval,
    handleRejectApproval,
    handleRerunActiveSession,
    handleCancelSession,
    handleDeleteActiveThread,
    handleForkSession,
    handleOpenSession,
    handleCloseTab,
    handleSelectTab,
    handleSwarmStarted,
    handleFeedback,
    handleNewTab,
  }
}
