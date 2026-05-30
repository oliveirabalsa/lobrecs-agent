import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Thread } from '../../../../shared/contracts/threads'
import { SUPPORTED_AGENT_IDS } from '../../../../shared/types'
import type {
  AgentId,
  AgentThinkingLevel,
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
import {
  readActiveThread,
  useWorkspaceThreadSelectionState,
  writeActiveThread,
} from './useWorkspaceThreadSelection'

export type MainView = 'workspace' | 'costs' | 'automations' | 'memory' | 'git'

const BLOCKING_SESSION_STATUSES = new Set<SessionStatus>([
  'running',
  'awaiting-approval',
  'awaiting-input',
])

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
  entries: ScopedDiffProposalEntry[]
}

export interface ScopedDiffProposalEntry {
  sessionId: string
  threadId: string | null
  proposals: DiffProposal[]
}

export function shouldOpenThreadLastSessionOnUpdate(input: {
  thread: Pick<Thread, 'id' | 'projectId' | 'lastSessionId'>
  activeThreadId: string | null
  activeSessionId: string | null
  selectedProjectId: string | null | undefined
}): boolean {
  const { thread, activeThreadId, activeSessionId, selectedProjectId } = input

  if (!activeThreadId || !selectedProjectId) return false
  if (thread.id !== activeThreadId || thread.projectId !== selectedProjectId) return false
  if (!thread.lastSessionId || thread.lastSessionId === activeSessionId) return false

  return true
}

export function visibleDiffProposalsForActiveSession(
  state: ScopedDiffProposalState | null,
  activeSessionId: string | null,
  activeThreadId: string | null,
): DiffProposal[] {
  if (!state || (!activeSessionId && !activeThreadId)) return []

  return (
    findScopedDiffProposalEntry(state, activeSessionId, activeThreadId)?.proposals ?? []
  )
}

export function nextScopedDiffProposalState(
  current: ScopedDiffProposalState | null,
  proposals: readonly DiffProposal[],
  source: DiffProposalScope,
  activeSessionId: string | null,
  activeThreadId: string | null,
): ScopedDiffProposalState | null {
  if (!activeSessionId && !activeThreadId) return current

  const sourceSessionId = source.sessionId ?? activeSessionId ?? ''
  const sourceThreadId = source.threadId ?? activeThreadId

  if (proposals.length === 0) return current

  const entries = current?.entries ?? []
  const existingEntry = findScopedDiffProposalEntry(
    current,
    sourceSessionId,
    sourceThreadId,
  )

  const nextEntry: ScopedDiffProposalEntry = {
    sessionId: sourceSessionId,
    threadId: sourceThreadId ?? null,
    proposals: mergeDiffProposals(existingEntry?.proposals ?? [], proposals),
  }

  return {
    entries: [
      ...entries.filter(
        (entry) => !scopedDiffProposalEntriesShareScope(entry, nextEntry),
      ),
      nextEntry,
    ],
  }
}

function findScopedDiffProposalEntry(
  state: ScopedDiffProposalState | null,
  sessionId: string | null | undefined,
  threadId: string | null | undefined,
): ScopedDiffProposalEntry | undefined {
  const normalizedThreadId = threadId ?? null
  const normalizedSessionId = sessionId ?? ''

  if (normalizedThreadId) {
    return state?.entries.find((entry) => entry.threadId === normalizedThreadId)
  }

  return state?.entries.find(
    (entry) => !entry.threadId && entry.sessionId === normalizedSessionId,
  )
}

function scopedDiffProposalEntriesShareScope(
  left: ScopedDiffProposalEntry,
  right: ScopedDiffProposalEntry,
): boolean {
  if (left.threadId || right.threadId) {
    return left.threadId === right.threadId
  }

  return left.sessionId === right.sessionId
}

export function mergeDiffProposals(
  current: readonly DiffProposal[],
  incoming: readonly DiffProposal[],
): DiffProposal[] {
  const byPath = new Map<string, DiffProposal>()

  for (const proposal of current) {
    byPath.set(proposal.filePath, proposal)
  }
  for (const proposal of incoming) {
    byPath.set(proposal.filePath, proposal)
  }

  return [...byPath.values()]
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
  const {
    selectedProject,
    setSelectedProject,
    activeSession,
    setActiveSession,
    activeSessionId,
    activeThreadId,
  } = useWorkspaceThreadSelectionState()
  const [diffProposalState, setDiffProposalState] =
    useState<ScopedDiffProposalState | null>(null)
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null)
  const [prefillPrompt, setPrefillPrompt] = useState<string | undefined>(undefined)
  const [prefillPromptRevision, setPrefillPromptRevision] = useState(0)
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [mainView, setMainView] = useState<MainView>('workspace')
  const [swarmOpen, setSwarmOpen] = useState(false)
  const [pendingQueue, setPendingQueue] = useState<QueuedMessage[]>([])
  const projectRestoreSeqRef = useRef(0)
  const threadRestoreSeqRef = useRef(0)
  const selectedProjectIdRef = useRef(selectedProject?.id ?? null)
  const activeThreadIdRef = useRef(activeThreadId)

  selectedProjectIdRef.current = selectedProject?.id ?? null
  activeThreadIdRef.current = activeThreadId

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
      return 'Respond to the pending agent request before starting another task'
    }
    if (isBusy) return 'Current session is still running'
    return undefined
  }, [activeSession?.status, approvalRequest, isBusy])

  function handleSelectedProjectDeleted() {
    projectRestoreSeqRef.current += 1
    threadRestoreSeqRef.current += 1
    selectedProjectIdRef.current = null
    setSelectedProject(null)
    setDiffProposalState(null)
    clearActiveThread()
  }

  function handleProjectSelect(project: Project) {
    const restoreSeq = projectRestoreSeqRef.current + 1
    projectRestoreSeqRef.current = restoreSeq
    threadRestoreSeqRef.current += 1
    selectedProjectIdRef.current = project.id
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
        if (projectRestoreSeqRef.current !== restoreSeq || selectedProjectIdRef.current !== project.id) {
          return
        }
        if (!thread || thread.projectId !== project.id || !thread.lastSessionId) {
          writeActiveThread(project.id, null)
          return
        }
        const session = await window.agentforge.sessions.get(thread.lastSessionId)
        if (projectRestoreSeqRef.current !== restoreSeq || selectedProjectIdRef.current !== project.id) {
          return
        }
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
      approvalMode: summary.approvalMode,
      thinking: summary.thinking,
      planMode: summary.planMode,
      createdAt: summary.createdAt ?? Date.now(),
    })
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
      setDiffProposalState((current) =>
        nextScopedDiffProposalState(
          current,
          proposals,
          source,
          activeSessionId,
          activeThreadId,
        ),
      )
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
        approvalMode: activeSession.approvalMode,
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
        approvalMode: activeSession.approvalMode,
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
      setBannerError(null)
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to cancel session')
    }
  }

  async function handleEnqueue(
    prompt: string,
    agentId?: AgentId,
    modelOverride?: string,
    approvalMode?: StartedSessionSummary['approvalMode'],
    profileId?: string,
    thinking?: AgentThinkingLevel,
  ): Promise<void> {
    if (!selectedProject || !activeThreadId) return

    try {
      await window.agentforge.agent.enqueue({
        threadId: activeThreadId,
        projectId: selectedProject.id,
        prompt,
        agentId,
        modelOverride,
        approvalMode,
        profileId,
        thinking,
      })
      setBannerError(null)
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to queue message')
      throw error
    }
  }

  async function handleDelegateTask(
    goal: string,
    options?: {
      approvalMode?: StartedSessionSummary['approvalMode']
      thinking?: AgentThinkingLevel
    },
  ): Promise<void> {
    if (!selectedProject || !activeThreadId || !activeSessionId) return

    try {
      await window.agentforge.agent.delegateTask({
        projectId: selectedProject.id,
        threadId: activeThreadId,
        parentSessionId: activeSessionId,
        goal,
        approvalMode: options?.approvalMode,
        thinking: options?.thinking,
      })
      setBannerError(null)
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to delegate task')
      throw error
    }
  }

  async function handleSteer(
    prompt: string,
    options?: {
      agentId?: AgentId
      modelOverride?: string
      approvalMode?: StartedSessionSummary['approvalMode']
      thinking?: AgentThinkingLevel
    },
  ): Promise<void> {
    if (!selectedProject || !activeSessionId) return

    try {
      const result = await window.agentforge.agent.steer({
        sessionId: activeSessionId,
        projectId: selectedProject.id,
        prompt,
        agentId: options?.agentId,
        modelOverride: options?.modelOverride,
        approvalMode: options?.approvalMode,
        thinking: options?.thinking,
      })
      handleSessionStarted({
        sessionId: result.sessionId,
        threadId: result.threadId,
        prompt,
        routingDecision: null,
        agentId: toStartedSessionAgentId(options?.agentId ?? activeSession?.agentId),
        modelOverride: options?.modelOverride ?? activeSession?.modelOverride,
        approvalMode: options?.approvalMode ?? activeSession?.approvalMode,
        thinking: options?.thinking ?? activeSession?.thinking,
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
        approvalMode: queuedMessage.approvalMode,
        thinking: queuedMessage.thinking,
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
        setPrefillPromptRevision((revision) => revision + 1)
      }
    } catch (error: unknown) {
      setBannerError(error instanceof Error ? error.message : 'Failed to fork session')
    }
  }

  function handleRestorePrompt(prompt: string) {
    if (!prompt.trim()) return
    setPrefillPrompt(prompt)
    setPrefillPromptRevision((revision) => revision + 1)
    setBannerError(null)
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
      approvalMode: undefined,
      planMode: session.planMode,
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
    setApprovalRequest(null)
    setBannerError(null)
  }

  useEffect(() => {
    if (!activeThreadId || !selectedProject?.id) return

    const unsubscribe = window.agentforge.threads.onUpdated((event) => {
      const thread = event.thread
      if (
        !shouldOpenThreadLastSessionOnUpdate({
          thread,
          activeThreadId,
          activeSessionId,
          selectedProjectId: selectedProject.id,
        })
      ) {
        return
      }

      const lastSessionId = thread.lastSessionId
      if (!lastSessionId) return
      const restoreSeq = threadRestoreSeqRef.current + 1
      threadRestoreSeqRef.current = restoreSeq

      void window.agentforge.sessions
        .get(lastSessionId)
        .then((session) => {
          if (
            threadRestoreSeqRef.current !== restoreSeq ||
            activeThreadIdRef.current !== activeThreadId ||
            selectedProjectIdRef.current !== selectedProject.id
          ) {
            return
          }
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
    if (selectedProject?.id !== project.id) {
      setDiffProposalState(null)
    }
    setSelectedProject(project)
    setActiveSession(null)
    tabs.resetTabs()
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
    prefillPromptRevision,
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
    handleDelegateTask,
    handleForceSteerQueuedMessage,
    handleRemoveQueueItem,
    handleClearQueue,
    pendingQueue,
    handleDeleteActiveThread,
    handleForkSession,
    handleRestorePrompt,
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
