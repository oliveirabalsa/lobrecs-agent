import { useEffect, useState } from 'react'

export function usePersistentBoolean(key: string, initialValue: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key)
      return stored === null ? initialValue : stored === 'true'
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, String(value))
    } catch {
      // UI preference only. Ignore storage failures.
    }
  }, [key, value])

  return [value, setValue] as const
}
