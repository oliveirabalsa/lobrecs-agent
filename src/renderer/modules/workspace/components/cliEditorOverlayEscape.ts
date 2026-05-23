export function closeCliEditorOverlay(
  event: Pick<KeyboardEvent, 'preventDefault' | 'stopPropagation' | 'key'>,
  onClose: () => void,
): void {
  if (event.key !== 'Escape') return

  event.preventDefault()
  event.stopPropagation()
  onClose()
}
