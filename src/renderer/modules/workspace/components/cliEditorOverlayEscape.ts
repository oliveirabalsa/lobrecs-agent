export function closeCliEditorOverlay(
  event: Pick<KeyboardEvent, 'preventDefault' | 'stopPropagation' | 'key' | 'metaKey'>,
  onClose: () => void,
  isVim = false,
): boolean {
  if (event.key !== 'Escape') return false
  if (isVim && !event.metaKey) return false

  event.preventDefault()
  event.stopPropagation()
  onClose()
  return true
}

