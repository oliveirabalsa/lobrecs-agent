import { useState } from 'react'
import type { ApprovalRequest } from '../../../../../shared/types'
import { Button } from '../../../../components/ui'

export interface ApprovalRequestPillProps {
  request: ApprovalRequest
  sessionId: string
  onApprove?: () => void | Promise<void>
  onReject?: () => void | Promise<void>
}

/**
 * ApprovalRequestPill — inline approval card rendered mid-stream.
 *
 * Shows: action label, risk badge, command (mono), cwd, Approve/Reject.
 * IPC: `window.agentforge.agent.approve|reject(sessionId)`.
 * Disappears (renders as decided summary) once the user decides.
 */
export function ApprovalRequestPill({
  request,
  sessionId,
  onApprove,
  onReject,
}: ApprovalRequestPillProps) {
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleApprove = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await (onApprove ? onApprove() : window.agentforge.agent.approve(sessionId))
      setDecision('approved')
    } catch (approveError: unknown) {
      setError(approveError instanceof Error ? approveError.message : 'Failed to approve request')
    } finally {
      setPending(false)
    }
  }

  const handleReject = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await (onReject ? onReject() : window.agentforge.agent.reject(sessionId))
      setDecision('rejected')
    } catch (rejectError: unknown) {
      setError(rejectError instanceof Error ? rejectError.message : 'Failed to reject request')
    } finally {
      setPending(false)
    }
  }

  if (decision !== null) {
    return (
      <div className="self-start rounded-card border border-hairline bg-card px-3 py-2 text-xs text-muted">
        Approval {decision}.
      </div>
    )
  }

  const risk = request.risk ?? 'medium'

  return (
    <article className="animate-approval-breathe self-start rounded-card border border-accent-warn/30 bg-accent-warn/10 px-3 py-2.5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-accent-warn">
            {request.description}
          </span>
          <RiskBadge risk={risk} />
        </div>

        {request.command ? (
          <pre className="overflow-auto whitespace-pre-wrap break-all rounded border border-hairline bg-canvas px-2 py-1.5 font-mono text-[11px] text-secondary">
            {request.command}
          </pre>
        ) : request.details ? (
          <div className="font-mono text-xs text-secondary">{request.details}</div>
        ) : null}

        {request.cwd ? (
          <div className="text-[11px] text-muted">
            <span className="font-mono">cwd: {request.cwd}</span>
          </div>
        ) : null}

        <div className="flex shrink-0 items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleReject} disabled={pending}>
            Reject
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleApprove}
            loading={pending}
          >
            Approve
          </Button>
        </div>
        {error ? <div className="text-xs text-accent-del">{error}</div> : null}
      </div>
    </article>
  )
}

function RiskBadge({ risk }: { risk: NonNullable<ApprovalRequest['risk']> }) {
  const styles: Record<typeof risk, string> = {
    low: 'border-accent-add/40 bg-accent-add/10 text-accent-add',
    medium: 'border-accent-warn/40 bg-accent-warn/10 text-accent-warn',
    high: 'border-accent-del/40 bg-accent-del/10 text-accent-del',
  }
  return (
    <span
      className={`inline-flex items-center rounded-pill border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${styles[risk]}`}
    >
      {risk} risk
    </span>
  )
}
