import { describe, expect, it } from 'vitest'
import { calculateModelPopoverFixedPosition } from './modelPopoverPosition'

describe('calculateModelPopoverFixedPosition', () => {
  it('right-aligns the popover to the trigger without leaving the viewport', () => {
    expect(
      calculateModelPopoverFixedPosition(
        { top: 300, right: 760, bottom: 328 },
        { width: 800, height: 700 },
      ),
    ).toMatchObject({
      left: 280,
      width: 480,
      transformOrigin: 'top right',
    })
  })

  it('clamps the popover when the trigger is near the left edge', () => {
    expect(
      calculateModelPopoverFixedPosition(
        { top: 300, right: 120, bottom: 328 },
        { width: 800, height: 700 },
      ).left,
    ).toBe(16)
  })

  it('opens above the trigger when the lower viewport cannot fit the picker', () => {
    const position = calculateModelPopoverFixedPosition(
      { top: 520, right: 760, bottom: 548 },
      { width: 800, height: 620 },
    )

    expect(position.transformOrigin).toBe('bottom right')
    expect(position.top).toBeLessThan(520)
  })
})
