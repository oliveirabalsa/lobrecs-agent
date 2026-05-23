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
 * `src/shared/contracts/threads.ts` plus a derived `sessionStatus` field so
 * the sidebar can drive spinners and timestamps without an extra round-trip.
 * `sessionStatus` is hydrated from `sessions.get(lastSessionId)` and kept in
 * sync via `session:*` event subscriptions; `thread:updated` events refresh
 * the rest of the thread metadata.
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
  sessionStatus: SessionStatus
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
 * and hydrates each one with the matching session's status. Threads without
 * a `lastSessionId` are filtered out — the sidebar can't render a spinner /
 * timestamp without one. Pinned threads bubble to the top, then by recency.
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

function mergeContractWithSession(
  thread: ThreadContract & { lastSessionId: string },
  session: Session | null,
  threadSessions: readonly Session[] = session ? [session] : [],
): Thread | null {
  if (!session) return null
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title || session.prompt.trim().slice(0, 60) || 'Untitled',
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    pinned: thread.pinned,
    lastSessionId: thread.lastSessionId,
    sessionStatus: session.status,
    agents: threadSessions
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((item, index) => ({
        sessionId: item.id,
        role: roleFromPrompt(item.prompt) ?? `agent ${index + 1}`,
        agentId: item.agentId,
        model: item.model,
        status: item.status,
        createdAt: item.createdAt,
      })),
  }
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

  // Subscribe to per-session events so the sidebar reflects live state
  // (status changes flip the spinner / timestamp without a refresh).
  useEffect(() => {
    const allThreads = Object.values(threadsByProject).flat().filter(Boolean) as Thread[]
    if (allThreads.length === 0) return

    const unsubscribers: Array<() => void> = []
    for (const thread of allThreads) {
      const off = window.agentforge.on(`session:${thread.lastSessionId}`, (event) => {
        const nextStatus = inferStatusFromEvent(event)
        if (!nextStatus) return
        setThreadsByProject((prev) => {
          const list = prev[thread.projectId]
          if (!list) return prev
          let mutated = false
          const updated = list.map((t) => {
            if (t.id !== thread.id) return t
            if (TERMINAL_STATUSES.has(t.sessionStatus) && nextStatus === 'running') {
              return t
            }
            if (
              t.sessionStatus === nextStatus &&
              t.updatedAt >= event.timestamp
            ) {
              return t
            }
            mutated = true
            return {
              ...t,
              sessionStatus: nextStatus,
              updatedAt: Math.max(t.updatedAt, event.timestamp),
              agents: t.agents.map((agent) =>
                agent.sessionId === thread.lastSessionId
                  ? { ...agent, status: nextStatus }
                  : agent,
              ),
            }
          })
          if (!mutated) return prev
          return { ...prev, [thread.projectId]: updated }
        })
      })
      unsubscribers.push(off)
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
          const hydrated = mergeContractWithSession(
            { ...incoming, lastSessionId: incoming.lastSessionId! },
            session,
            projectSessions.filter((item) => item.threadId === incoming.id),
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

function roleFromPrompt(prompt: string): string | null {
  const match = prompt.match(/^\s*\[Role:\s*([^\]]+)\]/i)
  const role = match?.[1]?.trim()
  return role || null
}
