import type { Project } from '../../../../shared/types'
import { ExtensionMarketplace } from '../components/ExtensionMarketplace'

interface ExtensionMarketplaceViewProps {
  isMac?: boolean
  selectedProject: Project | null
  onOpenSidebar?: () => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onClose?: () => void
}

export function ExtensionMarketplaceView({
  isMac = false,
  selectedProject,
  onOpenSidebar,
  sidebarCollapsed = false,
  onToggleSidebar,
  onClose,
}: ExtensionMarketplaceViewProps) {
  const leftInsetClass = isMac
    ? (sidebarCollapsed ? 'pl-[70px]' : 'pl-[70px] md:pl-4')
    : 'pl-2 md:pl-4'

  return (
    <main className="motion-fade-up-in flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas text-primary">
      <ExtensionsTopBar
        leftInsetClass={leftInsetClass}
        onOpenSidebar={onOpenSidebar}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onClose={onClose}
      />
      <ExtensionMarketplace selectedProject={selectedProject} />
    </main>
  )
}

function ExtensionsTopBar({
  leftInsetClass,
  onOpenSidebar,
  sidebarCollapsed,
  onToggleSidebar,
  onClose,
}: {
  leftInsetClass: string
  onOpenSidebar?: () => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onClose?: () => void
}) {
  return (
    <div
      className={`drag flex h-11 shrink-0 items-center gap-1 border-b border-hairline bg-canvas ${leftInsetClass} pr-2`}
    >
      {onOpenSidebar ? (
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
          className="no-drag flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-white/5 hover:text-primary md:hidden"
        >
          <MenuIcon />
        </button>
      ) : null}
      {onToggleSidebar ? (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          title={sidebarCollapsed ? 'Show sidebar (⌘B)' : 'Hide sidebar (⌘B)'}
          className="no-drag hidden h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-white/5 hover:text-primary md:flex"
        >
          <SidebarToggleIcon collapsed={!!sidebarCollapsed} />
        </button>
      ) : null}
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close extensions"
          title="Close extensions (Esc)"
          className="no-drag flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-white/5 hover:text-primary"
        >
          <CloseIcon />
        </button>
      ) : null}
    </div>
  )
}

function MenuIcon() {
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
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  )
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
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
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      {collapsed ? <path d="M12 10l2 2-2 2" /> : <path d="M14 14l-2-2 2-2" />}
    </svg>
  )
}

function CloseIcon() {
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
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
