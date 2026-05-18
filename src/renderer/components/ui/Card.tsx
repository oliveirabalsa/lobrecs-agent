import type { ReactNode } from 'react'

export type CardProps = {
  header?: ReactNode
  hoverable?: boolean
  className?: string
  children?: ReactNode
  onClick?: () => void
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

const BASE_CLASSES = 'bg-card rounded-card border border-hairline'

/**
 * Card — surface container with optional header slot. Renders as a
 * `<button>` when `onClick` is provided so the entire card is clickable.
 */
export function Card({
  header,
  hoverable = false,
  className,
  children,
  onClick,
}: CardProps) {
  const interactive = Boolean(onClick)
  const showHoverEffect = hoverable || interactive
  const hoverClasses = showHoverEffect
    ? 'transition-colors hover:bg-card-raised cursor-pointer'
    : ''
  const buttonClasses = interactive ? 'text-left w-full' : ''
  const composed = cx(BASE_CLASSES, hoverClasses, buttonClasses, className)

  const body = header ? (
    <>
      <div className="px-4 py-3 border-b border-hairline">{header}</div>
      <div className="px-4 py-3">{children}</div>
    </>
  ) : (
    <div className="px-4 py-3">{children}</div>
  )

  if (interactive) {
    return (
      <button type="button" className={composed} onClick={onClick}>
        {body}
      </button>
    )
  }

  return <div className={composed}>{body}</div>
}
