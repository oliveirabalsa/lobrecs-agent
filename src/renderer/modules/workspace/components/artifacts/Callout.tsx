import type { ReactNode } from 'react'

export type CalloutVariant = 'info' | 'warn' | 'danger'

export interface CalloutProps {
  variant?: CalloutVariant
  title?: ReactNode
  children?: ReactNode
  className?: string
}

const VARIANT_CLASSES: Record<
  CalloutVariant,
  { border: string; accent: string; text: string; iconColor: string }
> = {
  info: {
    border: 'border-accent-primary/30',
    accent: 'bg-accent-primary',
    text: 'text-accent-primary',
    iconColor: 'text-accent-primary',
  },
  warn: {
    border: 'border-accent-warn/30',
    accent: 'bg-accent-warn',
    text: 'text-accent-warn',
    iconColor: 'text-accent-warn',
  },
  danger: {
    border: 'border-accent-del/30',
    accent: 'bg-accent-del',
    text: 'text-accent-del',
    iconColor: 'text-accent-del',
  },
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/**
 * Callout — bordered block with a 3px left accent stroke + matching icon.
 * Used for inline warnings, info notes, danger callouts inside the stream.
 * Markdown parsing is deferred — `children` is rendered as-is.
 */
export function Callout({
  variant = 'info',
  title,
  children,
  className,
}: CalloutProps) {
  const tone = VARIANT_CLASSES[variant]
  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-card border bg-card pl-4 pr-3 py-2.5',
        tone.border,
        className,
      )}
      role="note"
    >
      <span
        aria-hidden="true"
        className={cx('absolute left-0 top-0 h-full w-[3px]', tone.accent)}
      />
      <div className="flex items-start gap-2">
        <span className={cx('mt-0.5 inline-flex shrink-0', tone.iconColor)} aria-hidden="true">
          {variant === 'warn' ? iconWarn : variant === 'danger' ? iconDanger : iconInfo}
        </span>
        <div className="min-w-0 flex-1 text-sm leading-6 text-primary">
          {title ? (
            <div className={cx('text-xs font-semibold uppercase tracking-wide mb-0.5', tone.text)}>
              {title}
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  )
}

const iconWarn = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M8 1.5 14.5 13H1.5L8 1.5Z" strokeLinejoin="round" />
    <path d="M8 6v3.5" strokeLinecap="round" />
    <circle cx="8" cy="11.25" r="0.6" fill="currentColor" stroke="none" />
  </svg>
)

const iconDanger = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 4.5V9" strokeLinecap="round" />
    <circle cx="8" cy="11.25" r="0.6" fill="currentColor" stroke="none" />
  </svg>
)

const iconInfo = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 7v4" strokeLinecap="round" />
    <circle cx="8" cy="4.75" r="0.6" fill="currentColor" stroke="none" />
  </svg>
)
