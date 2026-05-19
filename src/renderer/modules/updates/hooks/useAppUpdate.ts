import { useCallback, useEffect, useState } from 'react'
import type { AppUpdateState } from '../../../../shared/types'

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    void window.agentforge.updates
      .getState()
      .then((nextState) => {
        if (mounted) setState(nextState)
      })
      .catch((error) => {
        if (mounted) setActionError(errorMessage(error))
      })

    const unsubscribe = window.agentforge.updates.onStatus((nextState) => {
      setState(nextState)
      setActionError(null)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const run = useCallback(async (action: () => Promise<AppUpdateState | void>) => {
    setActionError(null)
    try {
      const nextState = await action()
      if (nextState) setState(nextState)
    } catch (error) {
      setActionError(errorMessage(error))
    }
  }, [])

  return {
    state,
    actionError,
    checkForUpdates: useCallback(() => run(() => window.agentforge.updates.check()), [run]),
    downloadUpdate: useCallback(() => run(() => window.agentforge.updates.download()), [run]),
    installAndRestart: useCallback(
      () => run(() => window.agentforge.updates.installAndRestart()),
      [run],
    ),
    openReleaseUrl: useCallback(
      () => run(() => window.agentforge.updates.openReleaseUrl()),
      [run],
    ),
    clearActionError: useCallback(() => setActionError(null), []),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
