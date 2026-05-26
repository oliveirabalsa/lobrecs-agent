export interface BackgroundWaitNoticeProps {
  message: string
}

export function BackgroundWaitNotice({ message }: BackgroundWaitNoticeProps) {
  return (
    <section className="relative overflow-hidden rounded-[22px] border border-amber-400/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.16),rgba(249,115,22,0.08)_42%,rgba(15,23,42,0.94)_100%)] px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.22),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.18),transparent_32%)]" />
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/55 to-transparent" />

      <div className="relative flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-amber-300/20 bg-black/20 text-amber-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
          <SparkRelayIcon />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-100/72">
              Background repair running
            </span>
            <span className="rounded-full border border-amber-300/18 bg-black/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-50/80">
              Non-blocking
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-amber-50/92">{message}</p>
        </div>

        <span
          className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-300/18 bg-black/15 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-amber-100/70"
          aria-hidden="true"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.75)]" />
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
