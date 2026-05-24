import { describe, expect, it } from 'vitest'
import { INITIAL_WINDOW_FALLBACK_BOUNDS, getInitialWindowBounds } from './windowBounds'

describe('getInitialWindowBounds', () => {
  it('uses the display work area so the window fills the desktop without native fullscreen', () => {
    expect(getInitialWindowBounds({ x: 0, y: 25, width: 1512, height: 912 })).toEqual({
      x: 0,
      y: 25,
      width: 1512,
      height: 912,
    })
  })

  it('falls back to the default window size when the display bounds are unavailable', () => {
    expect(getInitialWindowBounds(null)).toEqual(INITIAL_WINDOW_FALLBACK_BOUNDS)
    expect(getInitialWindowBounds({ x: 0, y: 0, width: 0, height: 900 })).toEqual(
      INITIAL_WINDOW_FALLBACK_BOUNDS,
    )
  })
})
