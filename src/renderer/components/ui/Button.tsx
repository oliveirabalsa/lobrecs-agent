import type { MouseEvent, ReactNode } from 'react'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'ghost' | 'chip' | 'circle'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  loading?: boolean
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  className?: string
  children?: ReactNode
  'aria-label'?: string
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

const BASE_CLASSES =
  'inline-flex items-center justify-center font-ui font-medium select-none ' +
  'transition-colors duration-150 outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-accent-primary/60 focus-visible:ring-offset-0 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'btn-shimmer bg-accent-primary text-white rounded-pill hover:bg-accent-primary/85 active:bg-accent-primary/75 shadow-md shadow-accent-primary/15 hover:shadow-lg hover:shadow-accent-primary/25 transition-all duration-150',
  ghost:
    'bg-transparent text-secondary rounded-card hover:bg-white/5 hover:text-primary active:bg-white/10',
  chip:
    'bg-card text-secondary border border-hairline rounded-pill hover:bg-card-raised hover:text-primary active:bg-card-raised',
  circle:
    'bg-black text-white rounded-pill hover:bg-black/85 active:bg-black/75',
}

// Padded sizes used by primary / ghost / chip.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-8 px-3 text-sm gap-2',
  lg: 'h-9 px-3.5 text-sm gap-2',
}

// `chip` variant gets a slightly tighter horizontal pad so the pill hugs label+chevron.
const CHIP_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2 text-xs gap-1',
  md: 'h-8 px-2.5 text-sm gap-1.5',
  lg: 'h-9 px-3 text-sm gap-1.5',
}

// Square dims for the circular send/stop button — no horizontal padding.
const CIRCLE_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-7 w-7 p-0',
  md: 'h-9 w-9 p-0',
  lg: 'h-10 w-10 p-0',
}

function getSizeClasses(variant: ButtonVariant, size: ButtonSize): string {
  if (variant === 'circle') return CIRCLE_SIZE_CLASSES[size]
  if (variant === 'chip') return CHIP_SIZE_CLASSES[size]
  return SIZE_CLASSES[size]
}

function getSpinnerSize(size: ButtonSize): 12 | 16 {
  return size === 'sm' ? 12 : 16
}

function hasTextContent(children: ReactNode): boolean {
  if (children === null || children === undefined || children === false) return false
  if (typeof children === 'string') return children.trim().length > 0
  if (typeof children === 'number') return true
  if (Array.isArray(children)) return children.some(hasTextContent)
  // ReactElement / portal / fragment etc. — treat as text-bearing to avoid false warnings.
  return true
}

export function Button({
  variant = 'ghost',
  size = 'md',
  leadingIcon,
  trailingIcon,
  loading = false,
  disabled = false,
  type = 'button',
  onClick,
  className,
  children,
  'aria-label': ariaLabel,
}: ButtonProps) {
  const isDisabled = disabled || loading
  const textPresent = hasTextContent(children)
  const iconOnly = !textPresent && Boolean(leadingIcon || trailingIcon || loading)

  if (
    process.env.NODE_ENV !== 'production' &&
    iconOnly &&
    !ariaLabel
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      '[ui/Button] Icon-only button is missing an `aria-label`; this is a screen-reader hazard.',
    )
  }

  const leading = loading ? (
    <Spinner size={getSpinnerSize(size)} />
  ) : (
    leadingIcon
  )

  const composed = cx(
    BASE_CLASSES,
    VARIANT_CLASSES[variant],
    getSizeClasses(variant, size),
    variant === 'primary' && loading && 'btn-shimmer-loading',
    className,
  )

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      className={composed}
    >
      {leading != null && (
        <span className="inline-flex shrink-0 items-center pointer-events-none">
          {leading}
        </span>
      )}
      {textPresent && <span className="pointer-events-none">{children}</span>}
      {trailingIcon != null && !loading && (
        <span className="inline-flex shrink-0 items-center pointer-events-none">
          {trailingIcon}
        </span>
      )}
    </button>
  )
}
