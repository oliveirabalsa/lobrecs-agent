import { useCallback, useEffect, useMemo, useState } from 'react'
import { SUPPORTED_AGENT_IDS } from '../../../../shared/types'
import type {
  AgentId,
  ApprovalRequest,
  DiffProposal,
  Project,
  QueuedMessage,
  Session,
  SessionStatus,
  SupportedAgentId,
} from '../../../../shared/types'
import { isSessionStatus } from '../../sessions/domain/sessionStatus'
import { useTabs, type Tab } from '../../sessions/state/tabs'
import type { ActiveSessionMeta, StartedSessionSummary } from '../../sessions/types'

export type MainView = 'workspace' | 'costs' | 'automations' | 'memory'

const ACTIVE_THREAD_KEY_PREFIX = 'activeThread:'
const BLOCKING_SESSION_STATUSES = new Set<SessionStatus>([
  'running',
  'awaiting-approval',
  'awaiting-input',
])

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
  if (typeof agentId === 'string' && SUPPORTED_AGENT_IDS.includes(agentId as SupportedAgentId)) {
    return agentId as SupportedAgentId
  }
  return undefined
}

export interface WorkspaceSwarmStartedResult {
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
}

export interface SwarmWorkspaceState {
  activeSession: ActiveSessionMeta
  tab: Tab
}

export interface DiffProposalScope {
  sessionId?: string | null
  threadId?: string | null
}

export interface ScopedDiffProposalState {
  sessionId: string
  threadId: string | null
  proposals: DiffProposal[]
}

export function visibleDiffProposalsForActiveSession(
  state: ScopedDiffProposalState | null,
  activeSessionId: string | null,
  activeThreadId: string | null,
): DiffProposal[] {
  if (!state || state.sessionId !== activeSessionId || state.threadId !== activeThreadId) {
    return []
  }

  return state.proposals
}

export function buildSwarmWorkspaceState(
  result: WorkspaceSwarmStartedResult,
  projectId: string,
  createdAt = Date.now(),
): SwarmWorkspaceState | null {
  const visibleSession = result.sessions.at(-1)
  if (!visibleSession) return null

  const status = isSessionStatus(visibleSession.status) ? visibleSession.status : 'running'
  const model = visibleSession.model
    ? `${visibleSession.agentId ?? 'agent'} / ${visibleSession.model}`
    : 'swarm'
  const prompt =
    result.sessions.length > 1
      ? `Swarm ${result.swarmId.slice(0, 8)} (${result.sessions.length} agents)`
      : `[${visibleSession.role}] swarm`

  return {
    activeSession: {
      id: visibleSession.sessionId,
      threadId: result.threadId,
      prompt,
      status,
      routingDecision: null,
      agentId: visibleSession.agentId,
      modelOverride: visibleSession.model ?? 'swarm',
      createdAt,
    },
    tab: {
      sessionId: visibleSession.sessionId,
      projectId,
      prompt,
      status,
      model,
      tier: 'balanced',
      createdAt,
    },
  }
}

export function useWorkspaceController() {
  const tabs = useTabs()
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [activeSession, setActiveSession] = useState<ActiveSessionMeta | null>(null)
  const [diffProposalState, setDiffProposalState] =
    useState<ScopedDiffProposalState | null>(null)
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null)
  const [prefillPrompt, setPrefillPrompt] = useState<string | undefined>(undefined)
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [mainView, setMainView] = useState<MainView>('workspace')
  const [swarmOpen, setSwarmOpen] = useState(false)
  const [pendingQueue, setPendingQueue] = useState<QueuedMessage[]>([])

  const activeSessionId = activeSession?.id ?? null
  const activeThreadId = activeSession?.threadId ?? null
  const diffProposals = useMemo(
    () =>
      visibleDiffProposalsForActiveSession(
        diffProposalState,
        activeSessionId,
        activeThreadId,
      ),
    [activeSessionId, activeThreadId, diffProposalState],
  )

  const clearActiveThread = useCallback(
    (projectId?: string) => {
      const targetProjectId = projectId ?? selectedProject?.id
      if (targetProjectId) writeActiveThread(targetProjectId, null)
      setActiveSession(null)
      setDiffProposalState(null)
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
        if (BLOCKING_SESSION_STATUSES.has(tab.status)) {
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
    return BLOCKING_SESSION_STATUSES.has(activeSession.status)
  }, [activeSession])

  const busyReason = useMemo(() => {
    if (approvalRequest) return 'Respond to the pending approval before starting another task'
    if (activeSession?.status === 'awaiting-input') {
      return 'Answer the agent question before starting another task'
    }
    if (isBusy) return 'Current session is still running'
    return undefined
  }, [activeSession?.status, approvalRequest, isBusy])

  function handleSelectedProjectDeleted() {
    setSelectedProject(null)
    clearActiveThread()
  }

  function handleProjectSelect(project: Project) {
    setSelectedProject(project)
    setActiveSession(null)
    tabs.resetTabs()
    setDiffProposalState(null)
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

  function handleProjectUpdated(project: Project) {
    setSelectedProject((current) => (current?.id === project.id ? project : current))
  }

  function handleSessionStarted(summary: StartedSessionSummary) {
    setActiveSession({
      id: summary.sessionId,
      threadId: summary.threadId,
      prompt: summary.prompt,
      imageAttachments: summary.imageAttachments,
      status: 'running',
      routingDecision: summary.routingDecision,
      agentId: summary.agentId,
      modelOverride: summary.modelOverride,
      createdAt: summary.createdAt ?? Date.now(),
    })
    setDiffProposalState(null)
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
    (proposals: DiffProposal[], source: DiffProposalScope = {}) => {
      const sourceSessionId = source.sessionId ?? activeSessionId
      const sourceThreadId = source.threadId ?? activeThreadId

      if (!sourceSessionId || sourceSessionId !== activeSessionId) return
      if ((sourceThreadId ?? null) !== activeThreadId) return

      setDiffProposalState({
        sessionId: sourceSessionId,
        threadId: sourceThreadId ?? null,
        proposals,
      })
    },
    [activeSessionId, activeThreadId],
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

  useEffect(() => {
    const unsubscribe = window.agentforge.onShortcut('shortcut:approve', () => {
      if (!approvalRequest || !activeSessionId) return
      void handleApproveApproval()
    })

    return unsubscribe
  }, [activeSessionId, approvalRequest])

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
        imageAttachments: activeSession.imageAttachments,
        threadId: activeSession.threadId,
      })
      const summary: StartedSessionSummary = {
        sessionId: result.sessionId,
        threadId: result.threadId,
        prompt,
        imageAttachments: activeSession.imageAttachments,
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
      setDiffProposalState(null)
      setBannerError(null)
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to cancel session')
    }
  }

  async function handleEnqueue(
    prompt: string,
    agentId?: AgentId,
    modelOverride?: string,
  ): Promise<void> {
    if (!selectedProject || !activeThreadId) return

    try {
      await window.agentforge.agent.enqueue({
        threadId: activeThreadId,
        projectId: selectedProject.id,
        prompt,
        agentId,
        modelOverride,
      })
      setBannerError(null)
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to queue message')
      throw error
    }
  }

  async function handleSteer(
    prompt: string,
    options?: { agentId?: AgentId; modelOverride?: string },
  ): Promise<void> {
    if (!selectedProject || !activeSessionId) return

    try {
      const result = await window.agentforge.agent.steer({
        sessionId: activeSessionId,
        projectId: selectedProject.id,
        prompt,
        agentId: options?.agentId,
        modelOverride: options?.modelOverride,
      })
      handleSessionStarted({
        sessionId: result.sessionId,
        threadId: result.threadId,
        prompt,
        routingDecision: null,
        agentId: toStartedSessionAgentId(options?.agentId ?? activeSession?.agentId),
        modelOverride: options?.modelOverride ?? activeSession?.modelOverride,
        createdAt: Date.now(),
      })
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to steer agent')
      throw error
    }
  }

  async function handleForceSteerQueuedMessage(messageId: string): Promise<void> {
    if (!selectedProject || !activeThreadId || !activeSessionId) return

    try {
      const queue = await window.agentforge.agent.getQueue(activeThreadId)
      const queuedMessage = queue.find((item) => item.id === messageId)
      if (!queuedMessage) {
        setBannerError('Queued message no longer exists')
        return
      }

      await window.agentforge.agent.dequeueItem(activeThreadId, messageId)
      await handleSteer(queuedMessage.prompt, {
        agentId: queuedMessage.agentId,
        modelOverride: queuedMessage.model,
      })
      setBannerError(null)
    } catch (error: unknown) {
      setBannerError(
        error instanceof Error ? error.message : 'Failed to force steer queued message',
      )
    }
  }

  async function handleRemoveQueueItem(messageId: string): Promise<void> {
    if (!activeThreadId) return
    await window.agentforge.agent.dequeueItem(activeThreadId, messageId).catch(() => undefined)
  }

  async function handleClearQueue(): Promise<void> {
    if (!activeThreadId) return
    await window.agentforge.agent.clearQueue(activeThreadId).catch(() => undefined)
  }

  async function handleDeleteActiveThread() {
    const threadId = activeSession?.threadId
    if (!threadId) return

    try {
      await window.agentforge.agent.clearQueue(threadId).catch(() => undefined)
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
      imageAttachments: session.imageAttachments,
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
    setDiffProposalState(null)
    setApprovalRequest(null)
    setBannerError(null)
  }

  useEffect(() => {
    if (!activeThreadId || !selectedProject?.id) return

    const unsubscribe = window.agentforge.threads.onUpdated((event) => {
      const thread = event.thread
      if (thread.id !== activeThreadId || thread.projectId !== selectedProject.id) return
      if (!thread.lastSessionId || thread.lastSessionId === activeSessionId) return

      void window.agentforge.sessions
        .get(thread.lastSessionId)
        .then((session) => {
          if (!session || session.threadId !== activeThreadId) return
          handleOpenSession(session)
        })
        .catch(() => undefined)
    })

    return unsubscribe
  }, [activeSessionId, activeThreadId, selectedProject?.id])

  useEffect(() => {
    if (!activeThreadId) {
      setPendingQueue([])
      return
    }

    let cancelled = false
    void window.agentforge.agent
      .getQueue(activeThreadId)
      .then((queue) => {
        if (!cancelled) setPendingQueue(queue)
      })
      .catch(() => undefined)

    const unsubscribe = window.agentforge.agent.onQueueUpdated((event) => {
      if (event.threadId !== activeThreadId) return
      setPendingQueue(event.pending)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeThreadId])

  async function handleCloseTab(sessionId: string) {
    const tab = tabs.tabs.find((item) => item.sessionId === sessionId)
    if (tab && BLOCKING_SESSION_STATUSES.has(tab.status)) {
      await window.agentforge.agent.cancel(sessionId).catch(() => undefined)
      tabs.updateStatus(sessionId, 'cancelled')
    }

    tabs.closeTab(sessionId)
    if (activeSession?.id === sessionId) {
      setActiveSession(null)
      setDiffProposalState(null)
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

  function handleSwarmStarted(result: WorkspaceSwarmStartedResult) {
    const state = buildSwarmWorkspaceState(result, selectedProject?.id ?? '')
    if (!state) return

    tabs.addTab(state.tab)
    setActiveSession(state.activeSession)
    if (selectedProject) writeActiveThread(selectedProject.id, result.threadId)
    setMainView('workspace')
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

  function handleNewChatForProject(project: Project) {
    // Clear the stored active thread for this project so handleProjectSelect
    // won't try to restore it asynchronously, then open a blank workspace.
    writeActiveThread(project.id, null)
    setSelectedProject(project)
    setActiveSession(null)
    tabs.resetTabs()
    setDiffProposalState(null)
    setApprovalRequest(null)
    setBannerError(null)
    setMainView('workspace')
  }

  function handleWorkspaceError(message: string) {
    setBannerError(message)
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
    toggleTerminal: () => setMainView('workspace'),
    setDiffProposals: (proposals: DiffProposal[]) => handleDiffProposals(proposals),
    handleDiffProposals,
    setMainView,
    setSwarmOpen,
    handleSelectedProjectDeleted,
    handleProjectSelect,
    handleProjectUpdated,
    handleSessionStarted,
    updateActiveStatus,
    handleApprovalRequest,
    handleApproveApproval,
    handleRejectApproval,
    handleRerunActiveSession,
    handleCancelSession,
    handleEnqueue,
    handleForceSteerQueuedMessage,
    handleRemoveQueueItem,
    handleClearQueue,
    pendingQueue,
    handleDeleteActiveThread,
    handleForkSession,
    handleOpenSession,
    handleCloseTab,
    handleSelectTab,
    handleSwarmStarted,
    handleFeedback,
    handleNewTab,
    handleNewChatForProject,
    handleWorkspaceError,
  }
}
