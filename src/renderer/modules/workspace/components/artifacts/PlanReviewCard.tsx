import { useState } from 'react'
import type { AgentDispatchResult } from '../../../../../shared/types'
import { Button } from '../../../../components/ui'

export interface PlanReviewCardProps {
  /** Identifier from the `plan-review` activity — echoed back to main. */
  reviewId: string
  /** The planning session that produced the plan above this card. */
  sessionId: string
}

/**
 * The terminal state of a plan review:
 *  - `approved` — the gated execution session was dispatched.
 *  - `rejected` — the plan was discarded.
 *  - `stale`    — main returned no execution session for an approval, so the
 *                 review was already resolved (or its session is gone). The
 *                 card must not claim execution is underway in this case.
 */
export type PlanReviewOutcome = 'approved' | 'rejected' | 'stale'

/**
 * Maps a submitted decision and the main-process response into the card's
 * terminal state.
 *
 * `planReviewDecision` resolves with the execution session on a successful
 * approval, or `null` when main no longer knows the review (already resolved,
 * or the planning session was cancelled). A `null` for an `approve` therefore
 * means nothing was dispatched — the card reports `stale` instead of falsely
 * claiming execution has begun. A `reject` always resolves with `null` by
 * contract, so it maps straight to `rejected`.
 */
export function resolvePlanReviewOutcome(
  choice: 'approve' | 'reject',
  result: AgentDispatchResult | null,
): PlanReviewOutcome {
  if (choice === 'reject') return 'rejected'
  return result ? 'approved' : 'stale'
}

/**
 * PlanReviewCard — inline Approve/Reject control rendered beneath a plan-mode
 * plan.
 *
 * The agent that produced the plan above has stopped without making changes.
 * Approving dispatches the gated execution session (`agent:plan-review-decision`);
 * the workspace then follows the new session via the thread-updated stream.
 * Rejecting discards the plan — the user redirects with a fresh message.
 *
 * Once decided, the card collapses to a resolved summary, mirroring
 * `ApprovalRequestPill`.
 */
export function PlanReviewCard({ reviewId, sessionId }: PlanReviewCardProps) {
  const [decision, setDecision] = useState<PlanReviewOutcome | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const decide = async (choice: 'approve' | 'reject') => {
    if (pending || decision !== null) return
    setPending(true)
    setError(null)
    try {
      const result = await window.agentforge.agent.planReviewDecision({
        reviewId,
        sessionId,
        decision: choice,
      })
      setDecision(resolvePlanReviewOutcome(choice, result))
    } catch (decisionError: unknown) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : 'Failed to submit plan decision',
      )
    } finally {
      setPending(false)
    }
  }

  if (decision !== null) {
    const resolvedText =
      decision === 'approved'
        ? 'Plan approved — executing.'
        : decision === 'rejected'
          ? 'Plan rejected.'
          : 'This plan review is no longer available.'
    return (
      <div className="self-start rounded-card border border-hairline bg-card px-3 py-2 text-xs text-muted">
        {resolvedText}
      </div>
    )
  }

  return (
    <article className="self-start rounded-card border border-accent-primary/30 bg-accent-primary/10 px-3 py-2.5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-accent-primary">
            {iconClipboard}
          </span>
          <span className="text-sm font-semibold text-accent-primary">
            Plan ready for review
          </span>
        </div>

        <p className="text-xs leading-5 text-secondary">
          The agent proposed the plan above and made no changes yet. Approve to
          let it execute the plan, or reject to discard it and redirect.
        </p>

        <div className="flex shrink-0 items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void decide('reject')}
            disabled={pending}
          >
            Reject
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void decide('approve')}
            loading={pending}
          >
            Approve &amp; execute
          </Button>
        </div>
        {error ? <div className="text-xs text-accent-del">{error}</div> : null}
      </div>
    </article>
  )
}

const iconClipboard = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z" />
    <path d="M8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2" />
    <path d="m9 13 2 2 4-4" />
  </svg>
)
