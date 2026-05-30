export interface BackgroundWaitNoticeProps {
  message: string
}

export function BackgroundWaitNotice({ message }: BackgroundWaitNoticeProps) {
  return (
    <section className="relative overflow-hidden rounded-card border border-accent-warn/25 bg-accent-warn/10 px-4 py-3">
      <div className="relative flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-accent-warn/25 bg-accent-warn/10 text-accent-warn">
          <SparkRelayIcon />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-warn">
              Background repair running
            </span>
            <span className="rounded-full border border-accent-warn/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-warn/80">
              Non-blocking
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-primary">{message}</p>
        </div>

        <span
          className="mt-1 inline-flex items-center gap-1 rounded-full border border-accent-warn/25 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-accent-warn/80"
          aria-hidden="true"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-warn" />
          live
        </span>
      </div>
    </section>
  )
}

function SparkRelayIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3 9.5 8.5 4 11l5.5 2.5L12 19l2.5-5.5L20 11l-5.5-2.5L12 3Z" />
      <path d="M5 4v3" />
      <path d="M3.5 5.5h3" />
      <path d="M19 17v4" />
      <path d="M17 19h4" />
    </svg>
  )
}
