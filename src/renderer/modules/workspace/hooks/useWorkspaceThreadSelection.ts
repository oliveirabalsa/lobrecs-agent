import { useState } from 'react'
import type { Project } from '../../../../shared/types'
import type { ActiveSessionMeta } from '../../sessions/types'

const ACTIVE_THREAD_KEY_PREFIX = 'activeThread:'

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

export function readActiveThread(projectId: string): string | null {
  return safeLocalStorage()?.getItem(`${ACTIVE_THREAD_KEY_PREFIX}${projectId}`) ?? null
}

export function writeActiveThread(projectId: string, threadId: string | null): void {
  const ls = safeLocalStorage()
  if (!ls) return
  const key = `${ACTIVE_THREAD_KEY_PREFIX}${projectId}`
  if (threadId) ls.setItem(key, threadId)
  else ls.removeItem(key)
}

export function useWorkspaceThreadSelectionState() {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [activeSession, setActiveSession] = useState<ActiveSessionMeta | null>(null)

  return {
    selectedProject,
    setSelectedProject,
    activeSession,
    setActiveSession,
    activeSessionId: activeSession?.id ?? null,
    activeThreadId: activeSession?.threadId ?? null,
  }
}

