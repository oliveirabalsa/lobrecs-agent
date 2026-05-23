import type { ReactNode } from 'react'

export interface SidebarActionsProps {
  onNewChat: () => void
  onSearch?: () => void
  onPlugins?: () => void
  onAutomations?: () => void
}

interface ActionRowProps {
  icon: ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  shortcut?: string
}

export function SidebarActions({
  onNewChat,
  onSearch,
  onPlugins,
  onAutomations,
}: SidebarActionsProps) {
  return (
    <nav className="flex flex-col px-1.5 py-1">
      <ActionRow
        icon={<NewChatIcon />}
        label="New chat"
        onClick={onNewChat}
        shortcut="⌘T"
      />
      <ActionRow
        icon={<SearchIcon />}
        label="Search"
        onClick={onSearch}
        disabled={!onSearch}
        shortcut="⌘K"
      />
      {onPlugins ? (
        <ActionRow
          icon={<PluginsIcon />}
          label="Extensions"
          onClick={onPlugins}
        />
      ) : null}
      {onAutomations ? (
        <ActionRow
          icon={<AutomationsIcon />}
          label="Automations"
          onClick={onAutomations}
        />
      ) : null}
    </nav>
  )
}

function ActionRow({ icon, label, onClick, disabled, shortcut }: ActionRowProps) {
  const baseClasses =
    'no-drag flex h-8 w-full items-center gap-3 rounded-card px-3 text-left transition-colors'
  const stateClasses = disabled
    ? 'cursor-not-allowed text-muted/60'
    : 'text-secondary hover:bg-white/5 hover:text-primary active:bg-white/10'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${stateClasses}`}
      title={disabled ? `${label} (coming soon)` : undefined}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">
        {icon}
      </span>
      <span className="flex-1 truncate text-[13px] leading-none">{label}</span>
      {shortcut ? (
        <span className="shrink-0 text-[10px] font-mono text-muted">{shortcut}</span>
      ) : null}
    </button>
  )
}

function NewChatIcon() {
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
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}

function SearchIcon() {
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
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function PluginsIcon() {
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
      <path d="M14 7V3h-4v4H6v4H2v4h4v4h4v4h4v-4h4v-4h4v-4h-4V7z" />
    </svg>
  )
}

function AutomationsIcon() {
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
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}
