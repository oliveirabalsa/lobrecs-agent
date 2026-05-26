import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ProviderUsageRow,
  ProviderUsageSummary,
  SupportedAgentId,
} from '../../../../shared/types'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})

const integerFormatter = new Intl.NumberFormat('en-US')

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
})

export function ProviderUsageMenu() {
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<ProviderUsageSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    function onDocClick(event: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) setOpen(false)
    }

    function onDocKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onDocKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onDocKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    let active = true
    setLoading(true)
    setError(null)

    window.agentforge.cost
      .providerUsage()
      .then((nextSummary) => {
        if (active) setSummary(nextSummary)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setSummary(null)
        setError(reason instanceof Error ? reason.message : 'Unable to load provider usage.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [open])

  const totals = useMemo(() => summarizeProviders(summary?.providers ?? []), [summary])
  const resetLabel = summary
    ? `Local meter resets ${dateFormatter.format(summary.periodEndsAt)}`
    : null

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Provider usage"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Provider usage"
        className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
          open
            ? 'border-accent-primary/50 bg-accent-primary/10 text-primary'
            : 'border-hairline text-secondary hover:border-white/20 hover:bg-white/5 hover:text-primary'
        }`}
      >
        <MoneyIcon />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-8 z-50 w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-card border border-hairline bg-card-raised/95 shadow-xl shadow-black/40 backdrop-blur-md"
        >
          <div className="border-b border-hairline px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-primary">
                  Provider usage
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted">
                  {resetLabel ?? 'Current local month'}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs font-semibold tabular-nums text-primary">
                  {formatCurrency(totals.cost)}
                </div>
                <div className="text-[10px] text-muted">
                  {formatInteger(totals.sessions)} sessions
                </div>
              </div>
            </div>
          </div>

          <div className="max-h-[28rem] overflow-auto py-1">
            {loading && !summary ? (
              <ProviderUsageSkeleton />
            ) : error ? (
              <div className="px-3 py-3 text-xs text-accent-del">{error}</div>
            ) : summary ? (
              summary.providers.map((provider) => (
                <ProviderUsageRowView key={provider.agentId} provider={provider} />
              ))
            ) : (
              <div className="px-3 py-3 text-xs text-muted">No usage loaded yet.</div>
            )}
          </div>

          <div className="border-t border-hairline px-3 py-2 text-[11px] leading-4 text-muted">
            Limits and reset times depend on provider CLI support. Local cost is based on
            completed sessions recorded by this app.
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ProviderUsageRowView({ provider }: { provider: ProviderUsageRow }) {
  const tokens = provider.tokensIn + provider.tokensOut

  return (
    <div className="flex gap-3 px-3 py-2.5 transition-colors hover:bg-white/5">
      <ProviderIcon agentId={provider.agentId} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-primary">{provider.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  provider.installed ? 'bg-accent-add' : 'bg-muted'
                }`}
                aria-hidden="true"
              />
              <span>{provider.installed ? 'Installed' : 'Not installed'}</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-xs font-semibold tabular-nums text-primary">
              {formatCurrency(provider.totalCostUsd)}
            </div>
            <div className="text-[10px] text-muted">
              {formatInteger(provider.sessions)} runs
            </div>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <MetricPill label="Tokens" value={formatInteger(tokens)} />
          <MetricPill
            label="Reset"
            value={
              provider.limit.resetsAt
                ? dateFormatter.format(provider.limit.resetsAt)
                : 'Unknown'
            }
          />
        </div>

        <div className="mt-2 rounded border border-hairline bg-canvas/60 px-2 py-1.5">
          <div className="text-[11px] font-medium text-secondary">{provider.limit.label}</div>
          <div className="mt-0.5 text-[10px] leading-4 text-muted">{provider.limit.detail}</div>
        </div>
      </div>
    </div>
  )
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded border border-hairline bg-sidebar px-2 py-1">
      <div className="text-[9px] uppercase tracking-wide text-muted">{label}</div>
      <div className="truncate text-[11px] font-medium tabular-nums text-secondary">{value}</div>
    </div>
  )
}

function ProviderUsageSkeleton() {
  return (
    <div className="space-y-1 px-3 py-2">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex gap-3 py-2">
          <div className="h-8 w-8 animate-pulse rounded border border-hairline bg-sidebar" />
          <div className="min-w-0 flex-1">
            <div className="h-3 w-32 animate-pulse rounded bg-sidebar" />
            <div className="mt-2 h-3 w-48 animate-pulse rounded bg-sidebar" />
          </div>
        </div>
      ))}
    </div>
  )
}

function summarizeProviders(providers: ProviderUsageRow[]): { cost: number; sessions: number } {
  return providers.reduce(
    (total, provider) => ({
      cost: total.cost + provider.totalCostUsd,
      sessions: total.sessions + provider.sessions,
    }),
    { cost: 0, sessions: 0 },
  )
}

function formatCurrency(value: number): string {
  return currencyFormatter.format(value)
}

function formatInteger(value: number): string {
  return integerFormatter.format(value)
}

function ProviderIcon({ agentId }: { agentId: SupportedAgentId }) {
  const initials: Record<SupportedAgentId, string> = {
    codex: 'CX',
    'claude-code': 'CC',
    opencode: 'OC',
    antigravity: 'AG',
    cursor: 'CR',
  }

  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${providerIconClass(
        agentId,
      )}`}
      aria-hidden="true"
    >
      {initials[agentId]}
    </div>
  )
}

function providerIconClass(agentId: SupportedAgentId): string {
  if (agentId === 'codex') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
  if (agentId === 'claude-code') return 'border-amber-400/30 bg-amber-400/10 text-amber-200'
  if (agentId === 'opencode') return 'border-sky-400/30 bg-sky-400/10 text-sky-200'
  if (agentId === 'cursor') return 'border-violet-400/30 bg-violet-400/10 text-violet-200'
  return 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200'
}

function MoneyIcon() {
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
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v10" />
      <path d="M15 9.5c-.6-.7-1.7-1-3-1-1.6 0-2.7.7-2.7 1.8 0 1.2 1.2 1.6 2.9 1.9 1.8.3 2.8.8 2.8 1.9 0 1.2-1.2 1.9-3 1.9-1.4 0-2.6-.4-3.4-1.2" />
    </svg>
  )
}
