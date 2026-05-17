import { useEffect, useMemo } from 'react'
import type { SessionStatus } from '../../../shared/types'
import type { Tab } from '../../store/tabs'

interface Props {
  tabs: Tab[]
  activeTabId: string | null
  onSelect: (sessionId: string) => void
  onClose: (sessionId: string) => void
  onNewTab?: () => void
}

const STATUS_COLORS: Record<SessionStatus, string> = {
  running: 'text-blue-400',
  'awaiting-approval': 'text-amber-400',
  done: 'text-green-400',
  error: 'text-red-400',
  cancelled: 'text-zinc-500',
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  running: 'Running',
  'awaiting-approval': 'Approval',
  done: 'Done',
  error: 'Error',
  cancelled: 'Cancelled',
}

const CLOSABLE_STATUSES = new Set<SessionStatus>(['done', 'error', 'cancelled'])

export function TabBar({ tabs, activeTabId, onSelect, onClose, onNewTab }: Props) {
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.sessionId === activeTabId) ?? null,
    [activeTabId, tabs],
  )

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return

      const numericKey = Number.parseInt(event.key, 10)
      if (numericKey >= 1 && numericKey <= 9) {
        const tab = tabs[numericKey - 1]
        if (tab) {
          event.preventDefault()
          onSelect(tab.sessionId)
        }
        return
      }

      if (event.shiftKey) return

      if (event.key.toLowerCase() === 't' && onNewTab) {
        event.preventDefault()
        onNewTab()
        return
      }

      if (event.key.toLowerCase() === 'w' && activeTab) {
        event.preventDefault()
        requestClose(activeTab, onClose)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTab, onClose, onNewTab, onSelect, tabs])

  return (
    <div className="flex h-11 min-w-0 items-stretch border-b border-zinc-800 bg-zinc-950">
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        {tabs.length === 0 ? (
          <div className="flex items-center px-4 text-xs text-zinc-500">No active sessions</div>
        ) : (
          tabs.map((tab, index) => {
            const isActive = tab.sessionId === activeTabId
            const canClose = CLOSABLE_STATUSES.has(tab.status)

            return (
              <div
                key={tab.sessionId}
                className={`group flex min-w-44 max-w-72 items-center gap-2 border-r border-zinc-800 px-3 text-left text-xs transition ${
                  isActive ? 'bg-zinc-900 text-zinc-100' : 'bg-zinc-950 text-zinc-400'
                }`}
              >
                <button
                  type="button"
                  className="grid min-w-0 flex-1 grid-cols-[auto_1fr] items-center gap-x-2 gap-y-0.5 text-left"
                  onClick={() => onSelect(tab.sessionId)}
                  title={tab.prompt}
                >
                  <span
                    className={`row-span-2 h-2 w-2 rounded-full ${statusDotColor(tab.status)}`}
                    aria-hidden="true"
                  />
                  <span className="truncate font-medium">{tab.prompt || `Session ${index + 1}`}</span>
                  <span className="truncate text-[11px] text-zinc-500">
                    <span className={STATUS_COLORS[tab.status]}>{STATUS_LABELS[tab.status]}</span>
                    <span className="px-1 text-zinc-700">/</span>
                    {tab.model}
                  </span>
                </button>

                {(canClose || tab.status === 'running' || tab.status === 'awaiting-approval') && (
                  <button
                    type="button"
                    className={`h-6 w-6 shrink-0 rounded text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100 ${
                      canClose ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    onClick={() => requestClose(tab, onClose)}
                    aria-label={canClose ? 'Close tab' : 'Cancel and close tab'}
                    title={canClose ? 'Close tab' : 'Cancel and close tab'}
                  >
                    x
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>

      {onNewTab ? (
        <button
          type="button"
          className="w-11 shrink-0 border-l border-zinc-800 text-lg leading-none text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
          onClick={onNewTab}
          aria-label="New tab"
          title="New tab (Cmd+T)"
        >
          +
        </button>
      ) : null}
    </div>
  )
}

function requestClose(tab: Tab, onClose: (sessionId: string) => void): void {
  if (tab.status === 'running' || tab.status === 'awaiting-approval') {
    const confirmed = window.confirm('Cancel this running session and close its tab?')
    if (!confirmed) return
  }

  onClose(tab.sessionId)
}

function statusDotColor(status: SessionStatus): string {
  switch (status) {
    case 'running':
      return 'bg-blue-400'
    case 'awaiting-approval':
      return 'bg-amber-400'
    case 'done':
      return 'bg-green-400'
    case 'error':
      return 'bg-red-400'
    case 'cancelled':
      return 'bg-zinc-500'
  }
}
