import type { CSSProperties } from 'react'

export type SpinnerSize = 12 | 16

export type SpinnerProps = {
  size?: SpinnerSize
  className?: string
}

/**
 * Inline SVG spinner that uses `currentColor` so it inherits text color
 * from its container. Spins via Tailwind's `animate-spin` utility.
 */
export function Spinner({ size = 16, className }: SpinnerProps) {
  const style: CSSProperties = { width: size, height: size }
  const composed = className ? `animate-spin ${className}` : 'animate-spin'
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      className={composed}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
