import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '../../../../shared/types'

export interface UseWorkspaceGitActionsInput {
  selectedProject: Project | null
  busy: boolean
  commitDialogOpen: boolean
  branchesDialogOpen: boolean
}

export function useWorkspaceGitActions({
  selectedProject,
  busy,
  commitDialogOpen,
  branchesDialogOpen,
}: UseWorkspaceGitActionsInput) {
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)
  const [gitOperationRunning, setGitOperationRunning] = useState(false)
  const [gitMenuOpen, setGitMenuOpen] = useState(false)
  const [pendingChangeCount, setPendingChangeCount] = useState(0)
  const pendingProbeRef = useRef(0)

  const refreshPendingChanges = useCallback(() => {
    const projectId = selectedProject?.id
    if (!projectId) {
      setPendingChangeCount(0)
      return
    }

    const probeId = pendingProbeRef.current + 1
    pendingProbeRef.current = probeId
    void window.agentforge.git
      .getPendingChanges(projectId)
      .then((result) => {
        if (pendingProbeRef.current === probeId) setPendingChangeCount(result.fileCount)
      })
      .catch(() => {
        if (pendingProbeRef.current === probeId) setPendingChangeCount(0)
      })
  }, [selectedProject?.id])

  useEffect(() => {
    refreshPendingChanges()
  }, [refreshPendingChanges, busy, commitDialogOpen, gitMenuOpen])

  const refreshCurrentBranch = useCallback(() => {
    if (!selectedProject?.id) {
      setCurrentBranch(null)
      return
    }
    window.agentforge.git
      .getCurrentBranch(selectedProject.id)
      .then(setCurrentBranch)
      .catch(() => setCurrentBranch(null))
  }, [selectedProject?.id])

  useEffect(() => {
    refreshCurrentBranch()
  }, [refreshCurrentBranch, branchesDialogOpen])

  useEffect(() => {
    if (!selectedProject?.id) return
    const unsubscribe = window.agentforge.on('git:branch-changed', (payload: unknown) => {
      if (
        payload &&
        typeof payload === 'object' &&
        'projectId' in payload &&
        payload.projectId === selectedProject.id
      ) {
        refreshCurrentBranch()
      }
    })
    return unsubscribe
  }, [selectedProject?.id, refreshCurrentBranch])

  const handleGitPull = useCallback(async () => {
    if (!selectedProject || gitOperationRunning) return
    setGitOperationRunning(true)
    try {
      const result = await window.agentforge.git.pull(selectedProject.id)
      if (result.exitCode === 0) {
        window.alert('Git pull succeeded:\n' + result.stdout)
      } else {
        window.alert('Git pull failed:\n' + result.stderr)
      }
    } catch (error: unknown) {
      window.alert(
        `Git pull failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setGitOperationRunning(false)
      refreshPendingChanges()
      refreshCurrentBranch()
    }
  }, [selectedProject, gitOperationRunning, refreshPendingChanges, refreshCurrentBranch])

  const handleGitFetch = useCallback(async () => {
    if (!selectedProject || gitOperationRunning) return
    setGitOperationRunning(true)
    try {
      const result = await window.agentforge.git.fetch(selectedProject.id)
      if (result.exitCode === 0) {
        window.alert('Git fetch succeeded.')
      } else {
        window.alert('Git fetch failed:\n' + result.stderr)
      }
    } catch (error: unknown) {
      window.alert(
        `Git fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setGitOperationRunning(false)
      refreshPendingChanges()
      refreshCurrentBranch()
    }
  }, [selectedProject, gitOperationRunning, refreshPendingChanges, refreshCurrentBranch])

  return {
    currentBranch,
    gitOperationRunning,
    gitMenuOpen,
    pendingChangeCount,
    setGitMenuOpen,
    refreshPendingChanges,
    refreshCurrentBranch,
    handleGitPull,
    handleGitFetch,
  }
}

