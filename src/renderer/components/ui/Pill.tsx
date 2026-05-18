import type { ReactNode } from 'react'

export type PillTone = 'neutral' | 'success' | 'warn' | 'danger' | 'info'

export type PillProps = {
  tone?: PillTone
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  onClick?: () => void
  className?: string
  children?: ReactNode
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

const TONE_CLASSES: Record<PillTone, string> = {
  neutral: 'bg-card-raised border-hairline text-secondary',
  success: 'bg-accent-add/15 border-accent-add/30 text-accent-add',
  warn: 'bg-accent-warn/15 border-accent-warn/30 text-accent-warn',
  danger: 'bg-accent-del/15 border-accent-del/30 text-accent-del',
  info: 'bg-accent-primary/15 border-accent-primary/30 text-accent-primary',
}

const BASE_CLASSES =
  'inline-flex min-w-0 items-center gap-1.5 h-6 px-2.5 text-xs rounded-pill border whitespace-nowrap'

/**
 * Pill — small inline status/label chip. Renders as a `<button>` when
 * `onClick` is provided, otherwise a non-interactive `<span>`.
 */
export function Pill({
  tone = 'neutral',
  leadingIcon,
  trailingIcon,
  onClick,
  className,
  children,
}: PillProps) {
  const toneClasses = TONE_CLASSES[tone]
  // 80ms hover transition per the M0 design spec (see REFACTOR_AGENT_IDE.md
  // §2.9). Kept short so the pill feels responsive on rapid hover.
  const interactiveClasses = onClick
    ? 'hover:bg-white/5 transition-colors duration-[80ms] ease-out cursor-pointer'
    : ''
  const composed = cx(BASE_CLASSES, toneClasses, interactiveClasses, className)

  const inner = (
    <>
      {leadingIcon ? (
        <span className="inline-flex items-center" aria-hidden="true">
          {leadingIcon}
        </span>
      ) : null}
      {children !== null && children !== undefined ? (
        <span className="min-w-0 truncate">{children}</span>
      ) : null}
      {trailingIcon ? (
        <span className="inline-flex items-center" aria-hidden="true">
          {trailingIcon}
        </span>
      ) : null}
    </>
  )

  if (onClick) {
    return (
      <button type="button" className={composed} onClick={onClick}>
        {inner}
      </button>
    )
  }

  return <span className={composed}>{inner}</span>
}
