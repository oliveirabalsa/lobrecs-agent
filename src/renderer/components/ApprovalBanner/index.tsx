import { useEffect } from 'react'
import type { ApprovalRequest } from '../../../shared/types'

interface Props {
  request: ApprovalRequest
  sessionId: string
  onApprove: () => void
  onReject: () => void
}

export function ApprovalBanner({ request, sessionId, onApprove, onReject }: Props) {
  useEffect(() => {
    return window.agentforge.onShortcut('shortcut:approve', onApprove)
  }, [onApprove])

  return (
    <div className="flex min-h-14 items-center gap-3 border-t border-amber-700/70 bg-amber-950/70 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-xs text-amber-200">
            {request.action}
          </span>
          <span className="truncate text-sm font-medium text-amber-100">
            {request.description}
          </span>
        </div>
        <div className="mt-1 truncate font-mono text-xs text-amber-300/80">
          {request.details || `session ${sessionId}`}
        </div>
      </div>

      <button
        type="button"
        onClick={onReject}
        className="rounded-md border border-red-800 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-950/70"
      >
        Deny
      </button>
      <button
        type="button"
        onClick={onApprove}
        className="rounded-md border border-emerald-700 bg-emerald-950/60 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-900/70"
      >
        Allow Cmd+Shift+A
      </button>
    </div>
  )
}
