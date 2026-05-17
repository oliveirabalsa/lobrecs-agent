import { useEffect, useMemo, useState } from 'react'
import type { CostSummary, PeriodCostRow, Project } from '../../../shared/types'

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
        <div className="truncate text-xs font-medium text-zinc-200">{label}</div>
        <div className="text-[11px] text-zinc-500">{formatInteger(sessions)} sessions</div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-2 rounded-full bg-cyan-400 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-right text-xs tabular-nums text-zinc-300">{formatCurrency(value)}</div>
    </div>
  )
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-2 text-lg font-semibold tabular-nums text-zinc-100">{value}</div>
    </div>
  )
}

function SummarySkeleton() {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="h-3 w-24 animate-pulse rounded bg-zinc-800" />
      <div className="mt-3 h-6 w-28 animate-pulse rounded bg-zinc-800" />
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
      {message}
    </div>
  )
}

export function CostDashboard({ project }: CostDashboardProps) {
  const [period, setPeriod] = useState<PeriodOption>(30)
  const [summary, setSummary] = useState<CostSummary>(emptySummary)
  const [rows, setRows] = useState<PeriodCostRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    <section className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-zinc-100">Cost Dashboard</h2>
          <div className="mt-1 truncate text-xs text-zinc-500">
            {project ? project.name : 'No project selected'}
            {loading ? <span className="ml-2 text-cyan-300">Refreshing</span> : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-zinc-800 bg-zinc-900 p-1">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition ${
                  period === option
                    ? 'bg-cyan-400 text-zinc-950'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
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
            className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {!project ? (
          <EmptyState message="Select a project to load cost data." />
        ) : (
          <div className="space-y-5">
            {error ? (
              <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
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
              <section className="rounded-md border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-zinc-100">By Project</h3>
                  <span className="text-xs text-zinc-500">{period} days</span>
                </div>
                {loading ? (
                  <EmptyState message="Loading project costs..." />
                ) : projectRows.length > 0 ? (
                  <div className="divide-y divide-zinc-800/80">
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

              <section className="rounded-md border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-zinc-100">By Model</h3>
                  <span className="text-xs text-zinc-500">{period} days</span>
                </div>
                {loading ? (
                  <EmptyState message="Loading model costs..." />
                ) : modelRows.length > 0 ? (
                  <div className="divide-y divide-zinc-800/80">
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
