import { useMemo, useState } from 'react'
import type { AgentDispatchResult } from '../../../../../shared/types'
import { Button } from '../../../../components/ui'
import type { MarkdownPreviewDocument } from '../MarkdownPreviewer'

export interface PlanReviewCardProps {
  /** Identifier from the `plan-review` activity — echoed back to main. */
  reviewId: string
  /** The planning session that produced the plan above this card. */
  sessionId: string
  /** The assistant plan text rendered directly above this review control. */
  planText?: string
  onPreviewMarkdown?: (document: MarkdownPreviewDocument) => void
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

export function toPlanReviewMarkdownDocument(
  planText: string,
): MarkdownPreviewDocument {
  const normalized = planText.trim()
  return {
    title: 'Plan review.md',
    content: normalized || '_No plan text was captured for this review._',
    sourceLabel: 'Plan review',
    suggestedFileName: 'plan-review.md',
  }
}

function canPreviewPlan(planText?: string): planText is string {
  return typeof planText === 'string' && planText.trim().length > 0
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
export function PlanReviewCard({
  reviewId,
  sessionId,
  planText,
  onPreviewMarkdown,
}: PlanReviewCardProps) {
  const [decision, setDecision] = useState<PlanReviewOutcome | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const planDocument = useMemo(
    () =>
      canPreviewPlan(planText) ? toPlanReviewMarkdownDocument(planText) : null,
    [planText],
  )

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
    const resolvedText = decisionText(decision)
    return (
      <article className="self-start overflow-hidden rounded-card border border-hairline bg-card">
        <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted">
          <span
            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-card border ${decisionIconTone(
              decision,
            )}`}
            aria-hidden="true"
          >
            {decision === 'approved' ? iconApproved : decision === 'rejected' ? iconRejected : iconStale}
          </span>
          <span>{resolvedText}</span>
        </div>
      </article>
    )
  }

  return (
    <article className="self-start max-w-[min(620px,100%)] overflow-hidden rounded-card border border-hairline bg-card shadow-elevated">
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-accent-primary/30 bg-accent-primary/15 text-accent-primary">
          {iconClipboard}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-primary">Plan ready for review</div>
          <div className="text-[11px] text-muted">
            No files were changed yet. Approve to run this plan.
          </div>
        </div>
        <div className="ml-auto rounded-pill border border-accent-primary/25 bg-accent-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-primary">
          Plan mode
        </div>
      </header>

      <div className="grid gap-3 px-4 py-3">
        <div className="grid gap-1 text-xs leading-5 text-secondary">
          <div className="flex items-start gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary" />
            <span>The assistant plan is shown directly above this card.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary" />
            <span>Approve dispatches the execution session on this same thread.</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {planDocument && onPreviewMarkdown ? (
            <button
              type="button"
              onClick={() => onPreviewMarkdown(planDocument)}
              aria-label="Preview plan as Markdown"
              title="Preview plan as Markdown"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted hover:bg-white/5 hover:text-primary"
            >
              {iconDocument}
            </button>
          ) : null}
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
            Approve and execute
          </Button>
        </div>

        {error ? (
          <div className="rounded-card border border-accent-del/40 bg-accent-del/10 px-3 py-2 text-xs text-accent-del">
            {error}
          </div>
        ) : null}
      </div>
    </article>
  )
}

function decisionText(decision: PlanReviewOutcome): string {
  if (decision === 'approved') return 'Plan approved. Execution is now running.'
  if (decision === 'rejected') return 'Plan rejected. Submit a follow-up to redirect.'
  return 'This plan review is no longer available.'
}

function decisionIconTone(decision: PlanReviewOutcome): string {
  if (decision === 'approved') {
    return 'border-accent-primary/30 bg-accent-primary/15 text-accent-primary'
  }
  if (decision === 'rejected') return 'border-hairline bg-card-raised text-secondary'
  return 'border-hairline bg-card-raised text-muted'
}

const iconApproved = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m3.5 8.4 2.3 2.3 6.7-6.1" />
  </svg>
)

const iconRejected = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="m4.3 4.3 7.4 7.4" />
    <path d="m11.7 4.3-7.4 7.4" />
  </svg>
)

const iconStale = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5.6v2.8" />
    <path d="M8 10.7h.01" />
  </svg>
)

const iconDocument = (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    aria-hidden="true"
  >
    <path d="M4 2.5h5l3 3V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
    <path d="M9 2.5V5a1 1 0 0 0 1 1h2" />
    <path d="M5 8h6M5 10.5h5M5 12.5h3" strokeLinecap="round" />
  </svg>
)

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
