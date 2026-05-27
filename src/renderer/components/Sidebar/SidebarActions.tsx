import type { ReactNode } from 'react'

export interface SidebarActionsProps {
  onNewChat: () => void
  onSearch?: () => void
  onPlugins?: () => void
  onAutomations?: () => void
  onCliTools?: () => void
  onOpenGit?: () => void
  cliToolsActive?: boolean
  gitActive?: boolean
}

interface ActionRowProps {
  icon: ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  shortcut?: string
  active?: boolean
}

export function SidebarActions({
  onNewChat,
  onSearch,
  onPlugins,
  onAutomations,
  onCliTools,
  onOpenGit,
  cliToolsActive = false,
  gitActive = false,
}: SidebarActionsProps) {
  return (
    <nav className="flex flex-col px-1.5 pt-1 pb-0.5">
      <ActionRow
        icon={<NewChatIcon />}
        label="New chat"
        onClick={onNewChat}
      />
      <ActionRow
        icon={<SearchIcon />}
        label="Search"
        onClick={onSearch}
        disabled={!onSearch}
      />
      {onPlugins ? (
        <ActionRow
          icon={<PluginsIcon />}
          label="Extensions"
          onClick={onPlugins}
        />
      ) : null}
      {onCliTools ? (
        <ActionRow
          icon={<CliToolsIcon />}
          label="CLIs"
          onClick={onCliTools}
          active={cliToolsActive}
        />
      ) : null}
      {onAutomations ? (
        <ActionRow
          icon={<AutomationsIcon />}
          label="Automations"
          onClick={onAutomations}
        />
      ) : null}
      {onOpenGit ? (
        <ActionRow
          icon={<GitIcon />}
          label="Git"
          onClick={onOpenGit}
          active={gitActive}
        />
      ) : null}
    </nav>
  )
}

function GitIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

function ActionRow({ icon, label, onClick, disabled, shortcut, active }: ActionRowProps) {
  const baseClasses =
    'no-drag flex h-7 w-full items-center gap-2.5 rounded-card pl-2.5 pr-2 text-left transition-colors'
  const stateClasses = disabled
    ? 'cursor-not-allowed text-muted/60'
    : active
      ? 'bg-white/10 text-primary'
    : 'text-secondary hover:bg-white/5 hover:text-primary active:bg-white/10'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${stateClasses}`}
      title={disabled ? `${label} (coming soon)` : undefined}
    >
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center ${
          active ? 'text-primary' : 'text-muted'
        }`}
      >
        {icon}
      </span>
      <span className="flex-1 truncate text-[12.5px] font-medium leading-none">{label}</span>
      {shortcut ? (
        <span className="shrink-0 text-[10px] font-mono text-muted/70">{shortcut}</span>
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
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
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
      strokeWidth="1.75"
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
      strokeWidth="1.75"
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
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function CliToolsIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9l3 3-3 3" />
      <path d="M13 15h3" />
    </svg>
  )
}
