import NumberFlow from '@number-flow/react'
import { useEffect, useRef, useState } from 'react'
import { ChangeBar } from './ChangeBar'

export interface AnimatedDiffStatProps {
  additions: number
  deletions: number
  /** Extra classes applied to the wrapping element (e.g. font size). */
  className?: string
}

/**
 * AnimatedDiffStat — the Codex-style `+N · -M` diff summary.
 *
 * A `ChangeBar` graph leads, giving the change instant visual weight; the
 * `additions` then roll up in green and `deletions` in red. Whenever a count
 * changes (e.g. the agent makes another edit to the same file mid-run)
 * NumberFlow animates the digits and the value gives a short bounce.
 */
export function AnimatedDiffStat({
  additions,
  deletions,
  className,
}: AnimatedDiffStatProps) {
  return (
    <span className={`inline-flex items-center font-mono ${className ?? ''}`}>
      <ChangeBar additions={additions} deletions={deletions} className="mr-2" />
      <DiffNumber value={additions} prefix="+" tone="add" />
      <span className="mx-1 text-muted">·</span>
      <DiffNumber value={deletions} prefix="-" tone="del" />
    </span>
  )
}

function DiffNumber({
  value,
  prefix,
  tone,
}: {
  value: number
  prefix: string
  tone: 'add' | 'del'
}) {
  const ref = useRef<HTMLSpanElement>(null)
  // null = first mount (skip bounce, but still count up from 0)
  const previous = useRef<number | null>(null)
  const [displayValue, setDisplayValue] = useState(0)

  useEffect(() => {
    const element = ref.current
    const isUpdate = previous.current !== null && previous.current !== value
    if (element && isUpdate) {
      element.classList.remove('diff-stat-bounce')
      void element.offsetWidth
      element.classList.add('diff-stat-bounce')
    }
    previous.current = value
    setDisplayValue(value)
  }, [value])

  return (
    <span
      ref={ref}
      className={`inline-flex tabular-nums ${
        tone === 'add' ? 'text-accent-add' : 'text-accent-del'
      }`}
    >
      <NumberFlow value={displayValue} prefix={prefix} />
    </span>
  )
}
