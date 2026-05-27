export interface PopoverAnchorRect {
  top: number
  right: number
  bottom: number
}

export interface PopoverViewport {
  width: number
  height: number
}

export interface ModelPopoverFixedPosition {
  left: number
  top: number
  width: number
  maxHeight: number
  transformOrigin: 'top right' | 'bottom right'
}

const GAP = 8
const VIEWPORT_PADDING = 16
const MAX_WIDTH = 480
const MAX_HEIGHT = 380
const MIN_HEIGHT = 260

export function calculateModelPopoverFixedPosition(
  anchor: PopoverAnchorRect,
  viewport: PopoverViewport,
): ModelPopoverFixedPosition {
  const availableWidth = Math.max(0, viewport.width - VIEWPORT_PADDING * 2)
  const width = Math.min(MAX_WIDTH, availableWidth)
  const rightAlignedLeft = anchor.right - width
  const left = clamp(
    rightAlignedLeft,
    VIEWPORT_PADDING,
    Math.max(VIEWPORT_PADDING, viewport.width - width - VIEWPORT_PADDING),
  )

  const availableBelow = viewport.height - anchor.bottom - GAP - VIEWPORT_PADDING
  const availableAbove = anchor.top - GAP - VIEWPORT_PADDING
  const opensBelow = availableBelow >= MIN_HEIGHT || availableBelow >= availableAbove
  const availableHeight = Math.max(opensBelow ? availableBelow : availableAbove, MIN_HEIGHT)
  const maxHeight = Math.min(MAX_HEIGHT, availableHeight)
  const top = opensBelow
    ? Math.min(anchor.bottom + GAP, viewport.height - VIEWPORT_PADDING - maxHeight)
    : Math.max(VIEWPORT_PADDING, anchor.top - GAP - maxHeight)

  return {
    left,
    top,
    width,
    maxHeight,
    transformOrigin: opensBelow ? 'top right' : 'bottom right',
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
