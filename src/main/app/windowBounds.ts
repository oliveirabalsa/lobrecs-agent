export type WorkAreaBounds = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

export const INITIAL_WINDOW_FALLBACK_BOUNDS = {
  width: 1280,
  height: 820,
} as const

export function getInitialWindowBounds(
  workArea: WorkAreaBounds | null | undefined,
): WorkAreaBounds | typeof INITIAL_WINDOW_FALLBACK_BOUNDS {
  if (!workArea || workArea.width <= 0 || workArea.height <= 0) {
    return INITIAL_WINDOW_FALLBACK_BOUNDS
  }

  return {
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
  }
}
