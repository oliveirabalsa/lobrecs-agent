import NumberFlow from '@number-flow/react'
import { useEffect, useRef, useState } from 'react'
import { ChangeBar } from './ChangeBar'

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export interface AnimatedDiffStatProps {
  additions: number
  deletions: number
  /** Use `onAccent` when rendered on a bright primary/action surface. */
  variant?: 'default' | 'onAccent'
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
  variant = 'default',
  className,
}: AnimatedDiffStatProps) {
  return (
    <span
      className={cx('inline-flex items-center font-mono', className)}
      aria-label={`${additions} additions, ${deletions} deletions`}
    >
      <ChangeBar
        additions={additions}
        deletions={deletions}
        variant={variant}
        className={variant === 'onAccent' ? 'mr-1.5' : 'mr-2'}
      />
      <DiffNumber value={additions} prefix="+" tone="add" variant={variant} />
      <span className={variant === 'onAccent' ? 'mx-1 text-white/65' : 'mx-1 text-muted'}>
        ·
      </span>
      <DiffNumber value={deletions} prefix="-" tone="del" variant={variant} />
    </span>
  )
}

function DiffNumber({
  value,
  prefix,
  tone,
  variant,
}: {
  value: number
  prefix: string
  tone: 'add' | 'del'
  variant: 'default' | 'onAccent'
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
      className={cx(
        'inline-flex tabular-nums',
        variant === 'onAccent' && 'rounded-sm bg-black/25 px-1 py-px leading-none ring-1 ring-white/10',
        variant === 'default' && (tone === 'add' ? 'text-diff-add-text' : 'text-diff-del-text'),
        variant === 'onAccent' && (tone === 'add' ? 'text-diff-add-on-accent' : 'text-diff-del-on-accent'),
      )}
    >
      <NumberFlow value={displayValue} prefix={prefix} />
    </span>
  )
}
