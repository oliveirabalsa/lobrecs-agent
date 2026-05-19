import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AppSettings } from '../../../../shared/types'
import { settingsClient } from '../api/settingsClient'

interface SettingsContextValue {
  globalSettings: AppSettings | null
  loading: boolean
  error: string | null
  refresh: () => Promise<AppSettings | null>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [globalSettings, setGlobalSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const settings = await settingsClient.getGlobal()
      setGlobalSettings(settings)
      return settings
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load settings')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return settingsClient.onUpdated((event) => {
      setGlobalSettings(event.settings)
    })
  }, [])

  const value = useMemo(
    () => ({ globalSettings, loading, error, refresh }),
    [error, globalSettings, loading, refresh],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const value = useContext(SettingsContext)
  if (!value) {
    throw new Error('useSettings must be used inside SettingsProvider')
  }

  return value
}
