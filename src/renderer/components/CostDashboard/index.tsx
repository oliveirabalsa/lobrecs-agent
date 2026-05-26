import { useEffect, useMemo, useState } from 'react'
import type {
  CostSummary,
  PeriodCostRow,
  Project,
  ProviderUsageRow,
  ProviderUsageSummary,
  SupportedAgentId,
} from '../../../shared/types'

type CostDashboardProps = {
  project: Pick<Project, 'id' | 'name'> | null
}

type PeriodOption = 7 | 30 | 90

type BreakdownRow = {
  label: string
  sessions: number
  totalCost: number
}

const PERIOD_OPTIONS: PeriodOption[] = [7, 30, 90]

const emptySummary: CostSummary = {
  total_tokens_in: 0,
  total_tokens_out: 0,
  total_cost_usd: 0,
  session_count: 0,
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})

const integerFormatter = new Intl.NumberFormat('en-US')
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})
const providerInitials: Record<SupportedAgentId, string> = {
  codex: 'CX',
  'claude-code': 'CC',
  opencode: 'OC',
  antigravity: 'AG',
  cursor: 'CR',
}

function formatCurrency(value: number | null | undefined): string {
  return currencyFormatter.format(Number(value ?? 0))
}

function formatInteger(value: number | null | undefined): string {
  return integerFormatter.format(Number(value ?? 0))
}

function normalizeRows(rows: PeriodCostRow[]): PeriodCostRow[] {
  return rows.map((row) => ({
    project_name: row.project_name || 'Unknown project',
    model: row.model || 'Unknown model',
    sessions: Number(row.sessions ?? 0),
    total_cost: Number(row.total_cost ?? 0),
  }))
}

function aggregateRows(
  rows: PeriodCostRow[],
  getLabel: (row: PeriodCostRow) => string,
): BreakdownRow[] {
  const byLabel = new Map<string, BreakdownRow>()

  rows.forEach((row) => {
    const label = getLabel(row)
    const current = byLabel.get(label) ?? { label, sessions: 0, totalCost: 0 }

    current.sessions += row.sessions
    current.totalCost += row.total_cost

    byLabel.set(label, current)
  })

  return Array.from(byLabel.values()).sort((a, b) => b.totalCost - a.totalCost)
}

function escapeCsvValue(value: string | number): string {
  const rawValue = String(value)

  if (!/[",\n]/.test(rawValue)) {
    return rawValue
  }

  return `"${rawValue.replaceAll('"', '""')}"`
}

function exportCsv(rows: PeriodCostRow[], days: PeriodOption): void {
  const csv = [
    'project,model,sessions,cost_usd',
    ...rows.map((row) =>
      [
        escapeCsvValue(row.project_name),
        escapeCsvValue(row.model),
        row.sessions,
        row.total_cost.toFixed(6),
      ].join(','),
    ),
  ].join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = `lobrecs-agent-costs-${days}d-${Date.now()}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

function CostBar({ label, sessions, value, max }: {
  label: string
  sessions: number
  value: number
  max: number
}) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0

  return (
    <div className="grid grid-cols-[minmax(7rem,12rem)_1fr_5rem] items-center gap-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-secondary">{label}</div>
        <div className="text-[11px] text-muted">{formatInteger(sessions)} sessions</div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-card-raised">
        <div
          className="h-2 rounded-full bg-accent-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-right text-xs tabular-nums text-secondary">{formatCurrency(value)}</div>
    </div>
  )
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-sidebar px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-lg font-semibold tabular-nums text-primary">{value}</div>
    </div>
  )
}

function SummarySkeleton() {
  return (
    <div className="rounded-md border border-hairline bg-sidebar px-4 py-3">
      <div className="h-3 w-24 animate-pulse rounded bg-card-raised" />
      <div className="mt-3 h-6 w-28 animate-pulse rounded bg-card-raised" />
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-hairline px-4 py-8 text-center text-sm text-muted">
      {message}
    </div>
  )
}

export function CostDashboard({ project }: CostDashboardProps) {
  const [period, setPeriod] = useState<PeriodOption>(30)
  const [summary, setSummary] = useState<CostSummary>(emptySummary)
  const [rows, setRows] = useState<PeriodCostRow[]>([])
  const [providerUsage, setProviderUsage] = useState<ProviderUsageSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [providerLoading, setProviderLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providerError, setProviderError] = useState<string | null>(null)
  const [providerRefreshKey, setProviderRefreshKey] = useState(0)

  useEffect(() => {
    let isActive = true

    setProviderLoading(true)
    setProviderError(null)

    window.agentforge.cost
      .providerUsage()
      .then((nextSummary) => {
        if (isActive) setProviderUsage(nextSummary)
      })
      .catch((reason: unknown) => {
        if (!isActive) return

        setProviderUsage(null)
        setProviderError(
          reason instanceof Error ? reason.message : 'Unable to load provider usage.',
        )
      })
      .finally(() => {
        if (isActive) setProviderLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [providerRefreshKey])

  useEffect(() => {
    if (!project) {
      setSummary(emptySummary)
      setRows([])
      setLoading(false)
      setError(null)
      return
    }

    let isActive = true

    setLoading(true)
    setError(null)

    Promise.all([
      window.agentforge.cost.byProject(project.id),
      window.agentforge.cost.byPeriod(period),
    ])
      .then(([nextSummary, nextRows]) => {
        if (!isActive) {
          return
        }

        setSummary(nextSummary ?? emptySummary)
        setRows(normalizeRows(nextRows))
      })
      .catch((reason: unknown) => {
        if (!isActive) {
          return
        }

        setSummary(emptySummary)
        setRows([])
        setError(reason instanceof Error ? reason.message : 'Unable to load cost data.')
      })
      .finally(() => {
        if (isActive) {
          setLoading(false)
        }
      })

    return () => {
      isActive = false
    }
  }, [period, project])

  const totalTokens = Number(summary.total_tokens_in ?? 0) + Number(summary.total_tokens_out ?? 0)
  const projectRows = useMemo(() => aggregateRows(rows, (row) => row.project_name), [rows])
  const modelRows = useMemo(() => aggregateRows(rows, (row) => row.model), [rows])
  const maxProjectCost = Math.max(0, ...projectRows.map((row) => row.totalCost))
  const maxModelCost = Math.max(0, ...modelRows.map((row) => row.totalCost))
  const hasRows = rows.length > 0

  return (
    <section className="flex h-full min-h-0 flex-col bg-canvas text-primary">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-primary">Usage</h2>
          <div className="mt-1 truncate text-xs text-muted">
            Provider subscription usage and local cost tracking
            {loading ? <span className="ml-2 text-accent-primary">Refreshing</span> : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-hairline bg-sidebar p-1">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition ${
                  period === option
                    ? 'bg-accent-primary text-canvas'
                    : 'text-muted hover:bg-white/5 hover:text-primary'
                }`}
              >
                {option}d
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!hasRows}
            onClick={() => exportCsv(rows, period)}
            className="rounded-md border border-hairline px-3 py-2 text-xs font-medium text-secondary transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {!project ? (
          <div className="space-y-5">
            <ProviderUsageSection
              summary={providerUsage}
              loading={providerLoading}
              error={providerError}
              onRefresh={() => setProviderRefreshKey((value) => value + 1)}
            />
            <EmptyState message="Select a project to load local session costs." />
          </div>
        ) : (
          <div className="space-y-5">
            <ProviderUsageSection
              summary={providerUsage}
              loading={providerLoading}
              error={providerError}
              onRefresh={() => setProviderRefreshKey((value) => value + 1)}
            />

            {error ? (
              <div className="rounded-md border border-accent-del/40 bg-accent-del/10 px-4 py-3 text-sm text-accent-del">
                {error}
              </div>
            ) : null}

            {loading ? (
              <div className="grid gap-3 md:grid-cols-3">
                <SummarySkeleton />
                <SummarySkeleton />
                <SummarySkeleton />
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                <SummaryTile label="Month spend" value={formatCurrency(summary.total_cost_usd)} />
                <SummaryTile label="Tokens" value={formatInteger(totalTokens)} />
                <SummaryTile label="Sessions" value={formatInteger(summary.session_count)} />
              </div>
            )}

            <div className="grid gap-5 xl:grid-cols-2">
              <section className="rounded-md border border-hairline bg-card/60 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-primary">By Project</h3>
                  <span className="text-xs text-muted">{period} days</span>
                </div>
                {loading ? (
                  <EmptyState message="Loading project costs..." />
                ) : projectRows.length > 0 ? (
                  <div className="divide-y divide-hairline">
                    {projectRows.map((row) => (
                      <CostBar
                        key={row.label}
                        label={row.label}
                        sessions={row.sessions}
                        value={row.totalCost}
                        max={maxProjectCost}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No project costs for this period." />
                )}
              </section>

              <section className="rounded-md border border-hairline bg-card/60 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-primary">By Model</h3>
                  <span className="text-xs text-muted">{period} days</span>
                </div>
                {loading ? (
                  <EmptyState message="Loading model costs..." />
                ) : modelRows.length > 0 ? (
                  <div className="divide-y divide-hairline">
                    {modelRows.map((row) => (
                      <CostBar
                        key={row.label}
                        label={row.label}
                        sessions={row.sessions}
                        value={row.totalCost}
                        max={maxModelCost}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No model costs for this period." />
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export default CostDashboard

function ProviderUsageSection({
  summary,
  loading,
  error,
  onRefresh,
}: {
  summary: ProviderUsageSummary | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  const totals = useMemo(() => summarizeProviders(summary?.providers ?? []), [summary])

  return (
    <section className="rounded-md border border-hairline bg-card/60 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-primary">CLI Usage</h3>
          <div className="mt-1 text-xs text-muted">
            {summary
              ? `Updated ${dateTimeFormatter.format(summary.generatedAt)}`
              : 'Loads subscription and token telemetry from installed CLIs'}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-xs text-muted">
            <span className="font-semibold tabular-nums text-secondary">
              {formatCurrency(totals.cost)}
            </span>{' '}
            local spend
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="rounded-md border border-hairline px-3 py-2 text-xs font-medium text-secondary transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-accent-del/40 bg-accent-del/10 px-4 py-3 text-sm text-accent-del">
          {error}
        </div>
      ) : loading && !summary ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="rounded-md border border-hairline bg-sidebar p-4">
              <div className="h-4 w-32 animate-pulse rounded bg-card-raised" />
              <div className="mt-3 h-3 w-52 animate-pulse rounded bg-card-raised" />
              <div className="mt-4 h-2 w-full animate-pulse rounded bg-card-raised" />
            </div>
          ))}
        </div>
      ) : summary ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {summary.providers.map((provider) => (
            <ProviderUsageCard key={provider.agentId} provider={provider} />
          ))}
        </div>
      ) : (
        <EmptyState message="No provider usage loaded yet." />
      )}
    </section>
  )
}

function ProviderUsageCard({ provider }: { provider: ProviderUsageRow }) {
  const tokens = provider.tokensIn + provider.tokensOut
  const percent = provider.limit.usedPercent
  const barPercent =
    typeof percent === 'number' && Number.isFinite(percent)
      ? Math.min(100, Math.max(0, percent))
      : null

  return (
    <article className="rounded-md border border-hairline bg-sidebar p-4">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${providerIconClass(
            provider.agentId,
          )}`}
          aria-hidden="true"
        >
          {providerInitials[provider.agentId]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-primary">{provider.name}</div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    provider.installed ? 'bg-accent-add' : 'bg-muted'
                  }`}
                  aria-hidden="true"
                />
                <span>{provider.installed ? 'Installed' : 'Not installed'}</span>
                {provider.limit.source ? <span>via {provider.limit.source}</span> : null}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold tabular-nums text-primary">
                {formatCurrency(provider.totalCostUsd)}
              </div>
              <div className="text-[11px] text-muted">{formatInteger(provider.sessions)} runs</div>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <div className={`text-xs font-semibold ${limitToneClass(provider.limit.status)}`}>
                {provider.limit.label}
              </div>
              {provider.limit.resetsAt ? (
                <div className="text-[11px] text-muted">
                  Resets {dateTimeFormatter.format(provider.limit.resetsAt)}
                </div>
              ) : null}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-card-raised">
              <div
                className={`h-2 rounded-full transition-all ${limitBarClass(provider.limit.status)}`}
                style={{ width: `${barPercent ?? 0}%` }}
              />
            </div>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">
              {provider.limit.detail}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <MetricPill label="Tokens" value={formatInteger(tokens)} />
            <MetricPill label="Input" value={formatInteger(provider.tokensIn)} />
            <MetricPill label="Output" value={formatInteger(provider.tokensOut)} />
          </div>
        </div>
      </div>
    </article>
  )
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded border border-hairline bg-canvas/60 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wide text-muted">{label}</div>
      <div className="truncate text-[11px] font-medium tabular-nums text-secondary">{value}</div>
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

function providerIconClass(agentId: SupportedAgentId): string {
  if (agentId === 'codex') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
  if (agentId === 'claude-code') return 'border-amber-400/30 bg-amber-400/10 text-amber-200'
  if (agentId === 'opencode') return 'border-sky-400/30 bg-sky-400/10 text-sky-200'
  if (agentId === 'cursor') return 'border-violet-400/30 bg-violet-400/10 text-violet-200'
  return 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200'
}

function limitToneClass(status: ProviderUsageRow['limit']['status']): string {
  if (status === 'available') return 'text-accent-add'
  if (status === 'error') return 'text-accent-del'
  return 'text-muted'
}

function limitBarClass(status: ProviderUsageRow['limit']['status']): string {
  if (status === 'available') return 'bg-accent-add'
  if (status === 'error') return 'bg-accent-del'
  return 'bg-muted'
}
