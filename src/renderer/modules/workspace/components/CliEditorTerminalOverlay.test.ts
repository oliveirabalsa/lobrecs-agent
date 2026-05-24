import { describe, expect, it, vi } from 'vitest'
import { closeCliEditorOverlay } from './cliEditorOverlayEscape'

type OverlayKeyEvent = Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopPropagation' | 'metaKey'>

describe('closeCliEditorOverlay', () => {
  it('closes the overlay when Escape is pressed for non-Vim', () => {
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const onClose = vi.fn()
    const event: OverlayKeyEvent = {
      key: 'Escape',
      preventDefault,
      stopPropagation,
      metaKey: false,
    }

    const result = closeCliEditorOverlay(event, onClose, false)

    expect(result).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(stopPropagation).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape for Vim when Cmd is not pressed', () => {
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const onClose = vi.fn()
    const event: OverlayKeyEvent = {
      key: 'Escape',
      preventDefault,
      stopPropagation,
      metaKey: false,
    }

    const result = closeCliEditorOverlay(event, onClose, true)

    expect(result).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes the overlay for Vim when Cmd + Escape is pressed', () => {
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const onClose = vi.fn()
    const event: OverlayKeyEvent = {
      key: 'Escape',
      preventDefault,
      stopPropagation,
      metaKey: true,
    }

    const result = closeCliEditorOverlay(event, onClose, true)

    expect(result).toBe(true)
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
      metaKey: false,
    }

    const result = closeCliEditorOverlay(event, onClose, false)

    expect(result).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})

