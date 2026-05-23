import { describe, expect, it, vi } from 'vitest'
import { closeCliEditorOverlay } from './cliEditorOverlayEscape'

type OverlayKeyEvent = Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopPropagation'>

describe('closeCliEditorOverlay', () => {
  it('closes the overlay when Escape is pressed', () => {
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const onClose = vi.fn()
    const event: OverlayKeyEvent = {
      key: 'Escape',
      preventDefault,
      stopPropagation,
    }

    closeCliEditorOverlay(event, onClose)

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(stopPropagation).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys', () => {
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const onClose = vi.fn()
    const event: OverlayKeyEvent = {
      key: 'Enter',
      preventDefault,
      stopPropagation,
    }

    closeCliEditorOverlay(event, onClose)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
