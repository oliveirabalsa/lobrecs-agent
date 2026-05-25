import { useEffect } from 'react'
import {
  resolveGitTuiKeyCommand,
  type GitTuiKeyCommand,
} from '../state/gitTuiState'

interface UseGitTuiKeyboardInput {
  enabled: boolean
  onCommand: (command: GitTuiKeyCommand) => void
}

export function useGitTuiKeyboard({ enabled, onCommand }: UseGitTuiKeyboardInput) {
  useEffect(() => {
    if (!enabled) return

    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return

      const command = resolveGitTuiKeyCommand(event)
      if (command.type === 'noop') return

      event.preventDefault()
      onCommand(command)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, onCommand])
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return (
    target.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select'
  )
}
