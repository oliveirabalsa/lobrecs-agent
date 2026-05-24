import type { AgentActivity } from '../../../../../shared/types'

export type DelegationActivity = Extract<AgentActivity, { kind: 'delegation' }>

export interface DelegationCardProps {
  delegation: DelegationActivity
}

export function DelegationCard({ delegation }: DelegationCardProps) {
  const done = delegation.status === 'done'
  const failed = delegation.status === 'error' || delegation.status === 'cancelled'
  const body = delegation.summary ?? delegation.error ?? delegation.lastOutput

  return (
    <article
      className={`self-start w-full max-w-[min(620px,100%)] overflow-hidden rounded-card border bg-card ${
        failed
          ? 'border-accent-del/35'
          : done
            ? 'border-accent-add/30'
            : 'border-accent-primary/30'
      }`}
    >
      <header className="flex items-center gap-3 border-b border-hairline bg-card-raised px-3 py-2.5">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-card border ${
            failed
              ? 'border-accent-del/35 bg-accent-del/10 text-accent-del'
              : done
                ? 'border-accent-add/35 bg-accent-add/10 text-accent-add'
                : 'border-accent-primary/35 bg-accent-primary/10 text-accent-primary'
          }`}
          aria-hidden="true"
        >
          {done ? iconCheck : failed ? iconAlert : iconBranch}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-primary">
              Delegated task
            </span>
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                failed
                  ? 'bg-accent-del'
                  : done
                    ? 'bg-accent-add'
                    : 'animate-pulse bg-accent-primary'
              }`}
              aria-hidden="true"
            />
          </div>
          <div className="truncate text-[11px] text-muted">
            {delegation.agentId} / {delegation.model}
          </div>
        </div>
        <span className="shrink-0 rounded-pill border border-hairline bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
          {delegation.status}
        </span>
      </header>

      <div className="grid gap-2 px-3 py-3">
        <div className="break-words text-xs font-medium leading-5 text-primary">
          {delegation.goal}
        </div>
        {body ? (
          <div className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-card border border-hairline bg-canvas px-3 py-2 text-[11px] leading-5 text-secondary">
            {body}
          </div>
        ) : (
          <div className="rounded-card border border-hairline bg-canvas px-3 py-2 text-[11px] text-muted">
            Waiting for background agent output...
          </div>
        )}
      </div>
    </article>
  )
}

const iconBranch = (
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
    <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="18" r="3" />
    <path d="M9 6h3a6 6 0 0 1 6 6v3" />
    <path d="M6 9v9" />
  </svg>
)

const iconCheck = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m5 12 4 4L19 6" />
  </svg>
)

const iconAlert = (
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
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
)
