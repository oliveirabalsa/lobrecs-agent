interface SidebarTopZoneProps {
  isMac: boolean
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  logoUrl?: string
}

/**
 * Sidebar top zone — 44px tall, drag region for the macOS hiddenInset titlebar.
 *
 * On macOS we reserve ~70px of left padding so the traffic-light overlay does
 * not collide with our history arrows. On other platforms the controls sit
 * flush left.
 */
export function SidebarTopZone({
  isMac,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  logoUrl,
}: SidebarTopZoneProps) {
  const leftPad = isMac ? 'pl-[70px]' : 'pl-2'

  return (
    <div className={`drag flex h-11 shrink-0 items-center ${leftPad} pr-2`}>
      <div className="no-drag flex items-center gap-1">
        <ArrowButton
          direction="back"
          disabled={!canGoBack}
          onClick={onBack}
          aria-label="Back"
        />
        <ArrowButton
          direction="forward"
          disabled={!canGoForward}
          onClick={onForward}
          aria-label="Forward"
        />
      </div>
      <div className="flex-1" />
      {logoUrl ? (
        <img
          src={logoUrl}
          alt=""
          aria-hidden="true"
          className="h-4 w-4 shrink-0 rounded-sm opacity-80"
        />
      ) : null}
    </div>
  )
}

function ArrowButton({
  direction,
  disabled,
  onClick,
  'aria-label': ariaLabel,
}: {
  direction: 'back' | 'forward'
  disabled: boolean
  onClick: () => void
  'aria-label': string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex h-6 w-6 items-center justify-center rounded text-secondary transition-colors hover:bg-white/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {direction === 'back' ? (
          <polyline points="15 18 9 12 15 6" />
        ) : (
          <polyline points="9 18 15 12 9 6" />
        )}
      </svg>
    </button>
  )
}
