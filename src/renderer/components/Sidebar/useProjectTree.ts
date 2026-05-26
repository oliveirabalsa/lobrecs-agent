import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AgentEvent,
  Project,
  Session,
  SessionStatus,
  Thread as ThreadContract,
} from '../../../shared/types'

/**
 * Sidebar-facing thread shape. Mirrors the `Thread` contract from
 * `src/shared/contracts/threads.ts` plus derived session state so the sidebar
 * can reflect the parent session and any spawned child agents without another
 * round-trip. `thread:updated` refreshes the thread shape; `session:*`
 * subscriptions keep the aggregate status live between those refreshes.
 */
export interface Thread {
  id: string
  projectId: string
  title: string
  createdAt: number
  updatedAt: number
  pinned: boolean
  /** Required for sidebar status display — threads without sessions are hidden. */
  lastSessionId: string
  lastSessionStatus: SessionStatus
  sessionStatus: SessionStatus
  sessionIds: string[]
  agents: ThreadAgentSummary[]
}

export interface ThreadAgentSummary {
  sessionId: string
  role: string
  agentId: Session['agentId']
  model: string
  status: SessionStatus
  createdAt: number
}

interface ProjectTreeState {
  projects: Project[]
  loadingProjects: boolean
  projectsError: string | null
  expanded: Set<string>
  threadsByProject: Record<string, Thread[] | undefined>
  loadingThreadsFor: Set<string>
  threadErrorByProject: Record<string, string | undefined>
}

interface ProjectTreeApi extends ProjectTreeState {
  toggleExpand(projectId: string): void
  isExpanded(projectId: string): boolean
  reloadProjects(): Promise<void>
  refreshThreads(projectId: string): Promise<void>
  deleteThread(projectId: string, threadId: string): Promise<void>
}

const EXPAND_STORAGE_PREFIX = 'sidebarExpanded:'

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function readExpandedFlag(projectId: string): boolean {
  const ls = storage()
  if (!ls) return false
  return ls.getItem(`${EXPAND_STORAGE_PREFIX}${projectId}`) === '1'
}

function writeExpandedFlag(projectId: string, value: boolean): void {
  const ls = storage()
  if (!ls) return
  if (value) ls.setItem(`${EXPAND_STORAGE_PREFIX}${projectId}`, '1')
  else ls.removeItem(`${EXPAND_STORAGE_PREFIX}${projectId}`)
}

/**
 * Fetches threads for a project via the real `threads:list` IPC (added in M7)
 * and hydrates each one with the matching session's status plus any spawned
 * child-session state for the same thread. Threads without a `lastSessionId`
 * are filtered out. Pinned threads bubble to the top, then by recency.
 */
async function listThreadsForProject(projectId: string): Promise<Thread[]> {
  const contractThreads = await window.agentforge.threads.list(projectId)
  const withSession = contractThreads.filter(
    (thread): thread is ThreadContract & { lastSessionId: string } =>
      Boolean(thread.lastSessionId),
  )
  const projectSessions = await window.agentforge.sessions.list(projectId)
  const sessionsById = new Map(projectSessions.map((session) => [session.id, session]))
  const sessionsByThread = new Map<string, Session[]>()
  for (const session of projectSessions) {
    if (!session.threadId) continue
    const list = sessionsByThread.get(session.threadId) ?? []
    list.push(session)
    sessionsByThread.set(session.threadId, list)
  }

  const merged: Thread[] = withSession
    .filter((thread) => shouldShowThreadInSidebar(sessionsByThread.get(thread.id) ?? []))
    .map((thread) =>
      mergeContractWithSession(
        thread,
        sessionsById.get(thread.lastSessionId) ?? null,
        sessionsByThread.get(thread.id) ?? [],
      ),
    )
    .filter((thread): thread is Thread => thread !== null)

  return merged.sort(compareThreads)
}

export function shouldShowThreadInSidebar(threadSessions: readonly Session[]): boolean {
  return threadSessions.some((session) => !session.spawnedAgent)
}

function mergeContractWithSession(
  thread: ThreadContract & { lastSessionId: string },
  session: Session | null,
  threadSessions: readonly Session[] = session ? [session] : [],
): Thread | null {
  if (!session) return null
  const backgroundAgents = threadSessions
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .flatMap((item) => {
      const summary = threadAgentSummaryFromSession(item)
      return summary ? [summary] : []
    })

  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title || session.prompt.trim().slice(0, 60) || 'Untitled',
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    pinned: thread.pinned,
    lastSessionId: thread.lastSessionId,
    lastSessionStatus: session.status,
    sessionStatus: aggregateThreadSessionStatus(session.status, backgroundAgents),
    sessionIds: Array.from(new Set(threadSessions.map((item) => item.id))),
    agents: backgroundAgents,
  }
}

export function threadAgentSummaryFromSession(session: Session): ThreadAgentSummary | null {
  const role = session.spawnedAgent?.role.trim()
  if (!role) return null

  return {
    sessionId: session.id,
    role,
    agentId: session.agentId,
    model: session.model,
    status: session.status,
    createdAt: session.createdAt,
  }
}

const THREAD_STATUS_PRIORITY: readonly SessionStatus[] = [
  'awaiting-input',
  'awaiting-approval',
  'running',
]
const ACTIVE_THREAD_SESSION_STATUSES = new Set<SessionStatus>(THREAD_STATUS_PRIORITY)

export function aggregateThreadSessionStatus(
  lastSessionStatus: SessionStatus,
  agents: readonly ThreadAgentSummary[],
): SessionStatus {
  for (const status of THREAD_STATUS_PRIORITY) {
    if (lastSessionStatus === status) return status
    if (agents.some((agent) => agent.status === status)) return status
  }

  return lastSessionStatus
}

function compareThreads(a: Thread, b: Thread): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return b.updatedAt - a.updatedAt
}

const TERMINAL_STATUSES = new Set<SessionStatus>(['done', 'error', 'cancelled'])

function inferStatusFromEvent(event: AgentEvent): SessionStatus | null {
  if (event.type === 'approval-request') return 'awaiting-approval'
  if (event.type === 'error') return 'error'
  if (event.type === 'activity' && isUserQuestionActivity(event.payload)) {
    return 'awaiting-input'
  }
  if (event.type === 'session-complete') {
    const payload = event.payload as { status?: unknown } | null | undefined
    const status = payload?.status
    if (
      status === 'done' ||
      status === 'error' ||
      status === 'cancelled' ||
      status === 'running' ||
      status === 'awaiting-approval' ||
      status === 'awaiting-input'
    ) {
      return status
    }
    return 'done'
  }
  if (event.type === 'stdout' || event.type === 'stderr' || event.type === 'activity') {
    return 'running'
  }
  return null
}

function isUserQuestionActivity(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { kind?: unknown }).kind === 'user-question'
  )
}

export function useProjectTree(): ProjectTreeApi {
  const [projects, setProjects] = useState<Project[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [threadsByProject, setThreadsByProject] = useState<
    Record<string, Thread[] | undefined>
  >({})
  const [loadingThreadsFor, setLoadingThreadsFor] = useState<Set<string>>(new Set())
  const [threadErrorByProject, setThreadErrorByProject] = useState<
    Record<string, string | undefined>
  >({})

  // Track current threads in a ref so live event listeners always see the
  // latest snapshot without resubscribing on every state change.
  const threadsRef = useRef(threadsByProject)
  useEffect(() => {
    threadsRef.current = threadsByProject
  }, [threadsByProject])

  const reloadProjects = useCallback(async () => {
    setLoadingProjects(true)
    setProjectsError(null)
    try {
      const list = await window.agentforge.projects.list()
      setProjects(list)
      // Re-hydrate expanded set from localStorage.
      const restored = new Set<string>()
      for (const project of list) {
        if (readExpandedFlag(project.id)) restored.add(project.id)
      }
      setExpanded(restored)
    } catch (error: unknown) {
      setProjectsError(error instanceof Error ? error.message : 'Failed to load projects')
    } finally {
      setLoadingProjects(false)
    }
  }, [])

  useEffect(() => {
    void reloadProjects()
  }, [reloadProjects])

  const refreshThreads = useCallback(async (projectId: string) => {
    setLoadingThreadsFor((prev) => {
      if (prev.has(projectId)) return prev
      const next = new Set(prev)
      next.add(projectId)
      return next
    })
    setThreadErrorByProject((prev) => ({ ...prev, [projectId]: undefined }))
    try {
      const threads = await listThreadsForProject(projectId)
      setThreadsByProject((prev) => ({ ...prev, [projectId]: threads }))
    } catch (error: unknown) {
      setThreadErrorByProject((prev) => ({
        ...prev,
        [projectId]:
          error instanceof Error ? error.message : 'Failed to load threads',
      }))
    } finally {
      setLoadingThreadsFor((prev) => {
        if (!prev.has(projectId)) return prev
        const next = new Set(prev)
        next.delete(projectId)
        return next
      })
    }
  }, [])

  // Fetch threads for any newly expanded project that hasn't been loaded yet.
  useEffect(() => {
    for (const projectId of expanded) {
      if (threadsByProject[projectId] === undefined && !loadingThreadsFor.has(projectId)) {
        void refreshThreads(projectId)
      }
    }
  }, [expanded, threadsByProject, loadingThreadsFor, refreshThreads])

  // Subscribe to thread-owned session events so the sidebar reflects live
  // parent/background-agent state without requiring a thread refresh.
  useEffect(() => {
    const allThreads = Object.values(threadsByProject).flat().filter(Boolean) as Thread[]
    if (allThreads.length === 0) return

    const unsubscribers: Array<() => void> = []
    for (const thread of allThreads) {
      for (const sessionId of thread.sessionIds) {
        const off = window.agentforge.on(`session:${sessionId}`, (event) => {
          const nextStatus = inferStatusFromEvent(event)
          if (!nextStatus) return
          setThreadsByProject((prev) => {
            const list = prev[thread.projectId]
            if (!list) return prev
            let mutated = false
            const updated = list.map((t) => {
              if (t.id !== thread.id) return t
              const previousSessionStatus =
                sessionId === t.lastSessionId
                  ? t.lastSessionStatus
                  : t.agents.find((agent) => agent.sessionId === sessionId)?.status

              if (
                previousSessionStatus &&
                TERMINAL_STATUSES.has(previousSessionStatus) &&
                ACTIVE_THREAD_SESSION_STATUSES.has(nextStatus)
              ) {
                return t
              }

              const nextLastSessionStatus =
                sessionId === t.lastSessionId ? nextStatus : t.lastSessionStatus
              const nextAgents = t.agents.map((agent) =>
                agent.sessionId === sessionId ? { ...agent, status: nextStatus } : agent,
              )
              const nextThreadStatus = aggregateThreadSessionStatus(
                nextLastSessionStatus,
                nextAgents,
              )

              if (
                t.sessionStatus === nextThreadStatus &&
                t.lastSessionStatus === nextLastSessionStatus &&
                t.updatedAt >= event.timestamp &&
                nextAgents.every((agent, index) => agent.status === t.agents[index]?.status)
              ) {
                return t
              }

              mutated = true
              return {
                ...t,
                lastSessionStatus: nextLastSessionStatus,
                sessionStatus: nextThreadStatus,
                updatedAt: Math.max(t.updatedAt, event.timestamp),
                agents: nextAgents,
              }
            })
            if (!mutated) return prev
            return { ...prev, [thread.projectId]: updated }
          })
        })
        unsubscribers.push(off)
      }
    }

    return () => {
      for (const off of unsubscribers) off()
    }
  }, [threadsByProject])

  // Subscribe to main-side thread:updated broadcasts so renames / pins /
  // newly-created threads land in the sidebar without an explicit refresh.
  useEffect(() => {
    const unsubscribe = window.agentforge.threads.onUpdated((event) => {
      const incoming = event.thread
      const projectId = incoming.projectId
      if (!incoming.lastSessionId) return

      void window.agentforge.sessions
        .get(incoming.lastSessionId)
        .catch(() => null)
        .then(async (session) => {
          if (!session) return
          const projectSessions = await window.agentforge.sessions
            .list(projectId)
            .catch(() => [session])
          const threadSessions = projectSessions.filter((item) => item.threadId === incoming.id)
          if (!shouldShowThreadInSidebar(threadSessions)) return

          const hydrated = mergeContractWithSession(
            { ...incoming, lastSessionId: incoming.lastSessionId! },
            session,
            threadSessions,
          )
          if (!hydrated) return

          setThreadsByProject((prev) => {
            const list = prev[projectId]
            if (!list) {
              // Only insert into projects whose tree is already loaded; an
              // unexpanded project will fetch fresh when opened.
              return prev
            }
            const idx = list.findIndex((t) => t.id === hydrated.id)
            const next =
              idx >= 0
                ? list.map((t) => (t.id === hydrated.id ? hydrated : t))
                : [...list, hydrated]
            return { ...prev, [projectId]: next.sort(compareThreads) }
          })
        })
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = window.agentforge.threads.onDeleted((event) => {
      setThreadsByProject((prev) => {
        const list = prev[event.projectId]
        if (!list) return prev
        const next = list.filter((thread) => thread.id !== event.threadId)
        if (next.length === list.length) return prev
        return { ...prev, [event.projectId]: next }
      })
    })

    return unsubscribe
  }, [])

  const toggleExpand = useCallback((projectId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
        writeExpandedFlag(projectId, false)
      } else {
        next.add(projectId)
        writeExpandedFlag(projectId, true)
      }
      return next
    })
  }, [])

  const isExpanded = useCallback((projectId: string) => expanded.has(projectId), [expanded])

  const deleteThread = useCallback(async (projectId: string, threadId: string) => {
    await window.agentforge.threads.delete(threadId)
    setThreadsByProject((prev) => {
      const list = prev[projectId]
      if (!list) return prev
      return { ...prev, [projectId]: list.filter((thread) => thread.id !== threadId) }
    })
  }, [])

  return {
    projects,
    loadingProjects,
    projectsError,
    expanded,
    threadsByProject,
    loadingThreadsFor,
    threadErrorByProject,
    toggleExpand,
    isExpanded,
    reloadProjects,
    refreshThreads,
    deleteThread,
  }
}
