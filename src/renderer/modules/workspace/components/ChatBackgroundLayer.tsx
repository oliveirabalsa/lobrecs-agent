import type { CSSProperties } from 'react'
import type { ChatBackgroundSettings } from '../../../../shared/types'

interface ChatBackgroundLayerProps {
  dataUrl: string
  settings: ChatBackgroundSettings
}

function positionToCSS(position: ChatBackgroundSettings['position']): string {
  return position.replace('-', ' ')
}

function sizeToCSS(size: ChatBackgroundSettings['size']): string {
  if (size === 'stretch') return '100% 100%'
  return size
}

export function ChatBackgroundLayer({ dataUrl, settings }: ChatBackgroundLayerProps) {
  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    opacity: settings.opacity / 100,
    backgroundImage: `url("${dataUrl}")`,
    backgroundSize: sizeToCSS(settings.size),
    backgroundPosition: positionToCSS(settings.position),
    backgroundRepeat: settings.repeat,
    backgroundAttachment: settings.fixed ? 'fixed' : 'scroll',
    filter: settings.blur > 0 ? `blur(${settings.blur}px)` : undefined,
    zIndex: 0,
  }

  return <div aria-hidden style={style} />
}
