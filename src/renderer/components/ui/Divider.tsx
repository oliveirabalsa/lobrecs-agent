import type { ReactNode } from 'react'

export type DividerProps = {
  label?: ReactNode
  className?: string
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/**
 * Divider — hairline horizontal rule. With `label`, renders a centered
 * label flanked by hairlines (used for things like "Context automatically
 * compacted").
 */
export function Divider({ label, className }: DividerProps) {
  if (label === undefined || label === null) {
    return <div className={cx('h-px w-full bg-hairline my-3', className)} />
  }

  return (
    <div className={cx('flex items-center gap-3 my-4', className)}>
      <div className="h-px flex-1 bg-hairline" />
      <span className="text-xs text-muted">{label}</span>
      <div className="h-px flex-1 bg-hairline" />
    </div>
  )
}
