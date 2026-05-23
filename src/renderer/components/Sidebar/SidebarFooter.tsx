interface SidebarFooterProps {
  onOpenSettings?: () => void
  onOpenUsage?: () => void
  settingsActive?: boolean
  usageActive?: boolean
}

export function SidebarFooter({
  onOpenSettings,
  onOpenUsage,
  settingsActive = false,
  usageActive = false,
}: SidebarFooterProps) {
  if (!onOpenSettings && !onOpenUsage) return <footer className="mt-auto" />

  return (
    <footer className="mt-auto border-t border-hairline px-1.5 py-1.5">
      <div className="flex items-center gap-1">
        {onOpenSettings ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className={`no-drag flex h-8 min-w-0 flex-1 items-center gap-3 rounded-card px-3 text-left transition-colors ${
              settingsActive
                ? 'bg-white/10 text-primary'
                : 'text-secondary hover:bg-white/5 hover:text-primary'
            }`}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center ${
                settingsActive ? 'text-primary' : 'text-muted'
              }`}
            >
              <CogIcon />
            </span>
            <span className="flex-1 truncate text-[13px] leading-none">Settings</span>
          </button>
        ) : null}

        {onOpenUsage ? (
          <button
            type="button"
            onClick={onOpenUsage}
            aria-label="Usage"
            title="Usage"
            className={`no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-card transition-colors ${
              usageActive
                ? 'bg-white/10 text-primary'
                : 'text-muted hover:bg-white/5 hover:text-primary'
            }`}
          >
            <DollarIcon />
          </button>
        ) : null}
      </div>
    </footer>
  )
}

export function DollarIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v10" />
      <path d="M15 9.5c-.6-.7-1.7-1-3-1-1.6 0-2.7.7-2.7 1.8 0 1.2 1.2 1.6 2.9 1.9 1.8.3 2.8.8 2.8 1.9 0 1.2-1.2 1.9-3 1.9-1.4 0-2.6-.4-3.4-1.2" />
    </svg>
  )
}

function CogIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
