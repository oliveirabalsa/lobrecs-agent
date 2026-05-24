import { useCallback, useEffect, useState } from 'react'
import type { GitGraphData } from '../../../../shared/contracts/gitGraph'
import type { Project } from '../../../../shared/types'

export interface UseGitGraphDataResult {
  data: GitGraphData | null
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useGitGraphData(project: Project | null): UseGitGraphDataResult {
  const [data, setData] = useState<GitGraphData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!project) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }

    let isActive = true
    setLoading(true)
    setError(null)

    window.agentforge.git
      .getGraphData({ projectId: project.id })
      .then((next) => {
        if (!isActive) return
        setData(next)
      })
      .catch((reason: unknown) => {
        if (!isActive) return
        setData(null)
        setError(reason instanceof Error ? reason.message : 'Unable to load git graph.')
      })
      .finally(() => {
        if (isActive) setLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [project, refreshKey])

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1)
  }, [])

  return { data, loading, error, refresh }
}
