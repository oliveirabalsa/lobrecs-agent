const PLAN_EXECUTION_HEADER = '[Plan Mode] Your plan has been approved.'
const PLAN_EXECUTION_RELEASE = 'Execute it now in full:'

export function isPlanModeExecutionPrompt(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.startsWith(PLAN_EXECUTION_HEADER) && normalized.includes(PLAN_EXECUTION_RELEASE)
}

/**
 * PlanModeExecutionMessage turns the internal plan-mode release prompt into a
 * compact status card. The raw prompt still reaches the agent, but the user
 * sees the approved execution state instead of app plumbing.
 */
export function PlanModeExecutionMessage() {
  return (
    <article className="shadow-elevated ml-auto w-full max-w-[85%] overflow-hidden rounded-card border border-accent-primary/30 bg-card sm:max-w-[70%]">
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-accent-primary/30 bg-accent-primary/15 text-accent-primary">
          {iconPlanApproved}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-primary">Plan approved</div>
          <div className="text-[11px] text-muted">Execution session started</div>
        </div>
        <div className="ml-auto rounded-pill border border-accent-primary/25 bg-accent-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-primary">
          Plan mode
        </div>
      </header>

      <div className="grid gap-2 px-4 py-3 text-sm leading-6 text-secondary">
        <div className="flex items-start gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary" />
          <span>Applying the approved file changes.</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary" />
          <span>Running the verification steps from the plan.</span>
        </div>
      </div>
    </article>
  )
}

const iconPlanApproved = (
  <svg
    viewBox="0 0 16 16"
    width="15"
    height="15"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 2.5h5l3 3V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
    <path d="M9 2.5V5a1 1 0 0 0 1 1h2" />
    <path d="m5.2 9.3 1.7 1.7 3.9-4" />
  </svg>
)
