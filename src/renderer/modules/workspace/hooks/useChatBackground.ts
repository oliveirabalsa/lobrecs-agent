import { useEffect, useState } from 'react'
import type { ChatBackgroundSettings } from '../../../../shared/types'
import { useSettings } from '../../settings/state/SettingsProvider'

interface ChatBackgroundState {
  enabled: boolean
  dataUrl: string | null
  settings: ChatBackgroundSettings
}

export function useChatBackground(): ChatBackgroundState {
  const { globalSettings } = useSettings()
  const bg = globalSettings?.ui.chatBackground
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!bg?.enabled || !bg.imagePath) {
      setDataUrl(null)
      return
    }
    let cancelled = false
    void window.agentforge.system.loadBackgroundImage(bg.imagePath).then((url) => {
      if (!cancelled) setDataUrl(url)
    })
    return () => { cancelled = true }
  }, [bg?.enabled, bg?.imagePath])

  if (!bg) {
    return { enabled: false, dataUrl: null, settings: { enabled: false, imagePath: '', opacity: 8, blur: 0, size: 'cover', position: 'center', repeat: 'no-repeat', fixed: true } }
  }

  return { enabled: bg.enabled && !!dataUrl, dataUrl, settings: bg }
}
