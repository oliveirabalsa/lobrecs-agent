import { useCallback, useEffect, useMemo, useState } from 'react'
import { AGENT_LABELS, SUPPORTED_AGENT_IDS } from '../../../../shared/types'
import type {
  Automation,
  AutomationRun,
  Project,
  SupportedAgentId,
} from '../../../../shared/types'

type AutomationManagerProps = {
  project: Pick<Project, 'id' | 'name'> | null
}

type AutomationDraft = {
  name: string
  prompt: string
  schedule: string
  agentId: SupportedAgentId
}

const agentOptions: Array<{ label: string; value: SupportedAgentId }> =
  SUPPORTED_AGENT_IDS.map((agentId) => ({
    label: AGENT_LABELS[agentId],
    value: agentId,
  }))

const schedulePresets = [
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Daily 9h', value: '0 9 * * *' },
  { label: 'Mon 9h', value: '0 9 * * 1' },
]

const initialDraft: AutomationDraft = {
  name: '',
  prompt: '',
  schedule: schedulePresets[1].value,
  agentId: 'claude-code',
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return 'Never'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function sortAutomations(automations: Automation[]): Automation[] {
  return [...automations].sort((a, b) => {
    const aTime = a.nextRunAt ?? a.lastRunAt ?? a.createdAt
    const bTime = b.nextRunAt ?? b.lastRunAt ?? b.createdAt
    return aTime - bTime
  })
}

function sortRuns(runs: AutomationRun[]): AutomationRun[] {
  return [...runs].sort((a, b) => b.createdAt - a.createdAt)
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-hairline px-4 py-8 text-center text-sm text-muted">
      {message}
    </div>
  )
}

export function AutomationManager({ project }: AutomationManagerProps) {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [draft, setDraft] = useState<AutomationDraft>(initialDraft)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyRunId, setBusyRunId] = useState<string | null>(null)
  const [runningAutomationId, setRunningAutomationId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null)

  const loadTriage = useCallback(async () => {
    if (!project) {
      setAutomations([])
      setRuns([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [nextAutomations, nextRuns] = await Promise.all([
        window.agentforge.automations.list(project.id),
        window.agentforge.automations.listRuns(project.id),
      ])
      setAutomations(sortAutomations(nextAutomations ?? []))
      setRuns(sortRuns(nextRuns ?? []))
    } catch (reason) {
      setAutomations([])
      setRuns([])
      setError(reason instanceof Error ? reason.message : 'Unable to load automations.')
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => {
    setNotice(null)
    setDraft(initialDraft)
    void loadTriage()
  }, [loadTriage])

  const selectedAutomation = useMemo(
    () => automations.find((automation) => automation.id === selectedAutomationId) ?? automations[0],
    [automations, selectedAutomationId],
  )
  const runsByAutomation = useMemo(() => {
    const grouped = new Map<string, AutomationRun[]>()
    for (const run of runs) {
      const existing = grouped.get(run.automationId) ?? []
      existing.push(run)
      grouped.set(run.automationId, existing)
    }
    return grouped
  }, [runs])
  const dueAutomations = useMemo(
    () => automations.filter((automation) => automation.status === 'due' || automation.status === 'overdue'),
    [automations],
  )
  const runningRuns = useMemo(
    () => runs.filter((run) => run.status === 'queued' || run.status === 'running'),
    [runs],
  )
  const unreadRuns = useMemo(
    () => runs.filter((run) => run.unread && run.status !== 'running' && run.status !== 'queued'),
    [runs],
  )
  const failedRuns = useMemo(
    () => runs.filter((run) => run.status === 'failed' || run.status === 'cancelled'),
    [runs],
  )
  const reviewedRuns = useMemo(
    () => runs.filter((run) => run.reviewState === 'reviewed'),
    [runs],
  )

  async function createAutomation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!project || !draft.name.trim() || !draft.prompt.trim() || !draft.schedule.trim()) return

    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      const created = await window.agentforge.automations.create({
        projectId: project.id,
        name: draft.name.trim(),
        prompt: draft.prompt.trim(),
        schedule: draft.schedule.trim(),
        agentId: draft.agentId,
        enabled: true,
      })
      setAutomations((current) => sortAutomations([created, ...current]))
      setSelectedAutomationId(created.id)
      setDraft(initialDraft)
      setNotice('Automation saved.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save automation.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleAutomation(automation: Automation) {
    setError(null)
    setNotice(null)

    const enabled = !automation.enabled
    setAutomations((current) =>
      current.map((item) => (item.id === automation.id ? { ...item, enabled } : item)),
    )

    try {
      const updated = await window.agentforge.automations.update(automation.id, { enabled })
      setAutomations((current) =>
        sortAutomations(current.map((item) => (item.id === automation.id ? updated : item))),
      )
    } catch (reason) {
      setAutomations((current) =>
        current.map((item) =>
          item.id === automation.id ? { ...item, enabled: automation.enabled } : item,
        ),
      )
      setError(reason instanceof Error ? reason.message : 'Unable to update automation.')
    }
  }

  async function runAutomation(automation: Automation) {
    setRunningAutomationId(automation.id)
    setError(null)
    setNotice(null)

    try {
      const result = await window.agentforge.automations.runNow(automation.id)
      setNotice(`Session ${result.sessionId} started.`)
      await loadTriage()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to run automation.')
    } finally {
      setRunningAutomationId(null)
    }
  }

  async function deleteAutomation(automation: Automation) {
    setError(null)
    setNotice(null)

    const previousAutomations = automations
    setAutomations((current) => current.filter((item) => item.id !== automation.id))

    try {
      await window.agentforge.automations.delete(automation.id)
      if (selectedAutomationId === automation.id) setSelectedAutomationId(null)
      await loadTriage()
      setNotice('Automation deleted.')
    } catch (reason) {
      setAutomations(previousAutomations)
      setError(reason instanceof Error ? reason.message : 'Unable to delete automation.')
    }
  }

  async function acknowledgeRun(run: AutomationRun) {
    await mutateRun(run.id, () => window.agentforge.automations.acknowledgeRun(run.id))
  }

  async function reviewRun(run: AutomationRun) {
    await mutateRun(run.id, () => window.agentforge.automations.reviewRun(run.id))
  }

  async function retryRun(run: AutomationRun) {
    await mutateRun(run.id, async () => {
      const result = await window.agentforge.automations.retryRun(run.id)
      setNotice(`Retry session ${result.sessionId} started.`)
      return null
    })
  }

  async function mutateRun(runId: string, action: () => Promise<AutomationRun | null>) {
    setBusyRunId(runId)
    setError(null)
    setNotice(null)

    try {
      await action()
      await loadTriage()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update automation run.')
    } finally {
      setBusyRunId(null)
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-canvas text-primary">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-primary">Automation Triage</h2>
          <div className="mt-1 truncate text-xs text-muted">
            {project ? project.name : 'No project selected'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadTriage()}
          disabled={!project || loading}
          className="rounded-md border border-hairline px-3 py-2 text-xs font-medium text-secondary transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Refresh
        </button>
      </header>

      <div className="grid min-h-0 flex-1 gap-5 overflow-auto p-5 xl:grid-cols-[21rem_1fr]">
        {!project ? (
          <div className="xl:col-span-2">
            <EmptyState message="Select a project to manage automations." />
          </div>
        ) : (
          <>
            <AutomationForm
              draft={draft}
              saving={saving}
              onChange={setDraft}
              onSubmit={createAutomation}
            />

            <div className="min-w-0 space-y-5">
              {error ? <Callout tone="error">{error}</Callout> : null}
              {notice ? <Callout tone="success">{notice}</Callout> : null}

              <section className="grid gap-3 md:grid-cols-5">
                <Metric label="Due" value={dueAutomations.length} />
                <Metric label="Running" value={runningRuns.length} />
                <Metric label="Unread" value={unreadRuns.length} />
                <Metric label="Failed" value={failedRuns.length} />
                <Metric label="Reviewed" value={reviewedRuns.length} />
              </section>

              <section className="grid gap-5 2xl:grid-cols-[1fr_24rem]">
                <div className="space-y-5">
                  <InboxSection title="Due" count={dueAutomations.length}>
                    {loading ? (
                      <EmptyState message="Loading automations..." />
                    ) : dueAutomations.length > 0 ? (
                      dueAutomations.map((automation) => (
                        <AutomationRow
                          key={automation.id}
                          automation={automation}
                          selected={selectedAutomation?.id === automation.id}
                          running={runningAutomationId === automation.id}
                          latestRun={runsByAutomation.get(automation.id)?.[0]}
                          onSelect={setSelectedAutomationId}
                          onToggle={toggleAutomation}
                          onRun={runAutomation}
                          onDelete={deleteAutomation}
                        />
                      ))
                    ) : (
                      <EmptyState message="No scheduled automations are due." />
                    )}
                  </InboxSection>

                  <InboxSection title="Running" count={runningRuns.length}>
                    <RunList
                      runs={runningRuns}
                      automations={automations}
                      busyRunId={busyRunId}
                      onAcknowledge={acknowledgeRun}
                      onReview={reviewRun}
                      onRetry={retryRun}
                    />
                  </InboxSection>

                  <InboxSection title="Unread" count={unreadRuns.length}>
                    <RunList
                      runs={unreadRuns}
                      automations={automations}
                      busyRunId={busyRunId}
                      onAcknowledge={acknowledgeRun}
                      onReview={reviewRun}
                      onRetry={retryRun}
                    />
                  </InboxSection>

                  <InboxSection title="Failed Verification" count={failedRuns.length}>
                    <RunList
                      runs={failedRuns}
                      automations={automations}
                      busyRunId={busyRunId}
                      onAcknowledge={acknowledgeRun}
                      onReview={reviewRun}
                      onRetry={retryRun}
                    />
                  </InboxSection>

                  <InboxSection title="All Automations" count={automations.length}>
                    {automations.length > 0 ? (
                      automations.map((automation) => (
                        <AutomationRow
                          key={automation.id}
                          automation={automation}
                          selected={selectedAutomation?.id === automation.id}
                          running={runningAutomationId === automation.id}
                          latestRun={runsByAutomation.get(automation.id)?.[0]}
                          onSelect={setSelectedAutomationId}
                          onToggle={toggleAutomation}
                          onRun={runAutomation}
                          onDelete={deleteAutomation}
                        />
                      ))
                    ) : (
                      <EmptyState message="No automations for this project." />
                    )}
                  </InboxSection>
                </div>

                <AutomationDetail
                  automation={selectedAutomation}
                  runs={selectedAutomation ? runsByAutomation.get(selectedAutomation.id) ?? [] : []}
                />
              </section>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function AutomationForm({
  draft,
  saving,
  onChange,
  onSubmit,
}: {
  draft: AutomationDraft
  saving: boolean
  onChange: React.Dispatch<React.SetStateAction<AutomationDraft>>
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form onSubmit={onSubmit} className="h-fit rounded-md border border-hairline bg-card/60 p-4">
      <h3 className="text-sm font-semibold text-primary">New Automation</h3>

      <label className="mt-4 block text-xs font-medium text-muted">
        Name
        <input
          value={draft.name}
          onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
          className="mt-1 h-9 w-full rounded-md border border-hairline bg-canvas px-3 text-sm text-primary outline-none placeholder:text-muted focus:border-accent-primary"
          placeholder="Daily review"
        />
      </label>

      <label className="mt-3 block text-xs font-medium text-muted">
        Prompt
        <textarea
          value={draft.prompt}
          onChange={(event) => onChange((current) => ({ ...current, prompt: event.target.value }))}
          className="mt-1 h-28 w-full resize-none rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-primary outline-none placeholder:text-muted focus:border-accent-primary"
          placeholder="Review open work and report risks."
        />
      </label>

      <div className="mt-3">
        <div className="mb-2 text-xs font-medium text-muted">Schedule</div>
        <div className="grid grid-cols-3 gap-2">
          {schedulePresets.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => onChange((current) => ({ ...current, schedule: preset.value }))}
              className={`rounded-md border px-2 py-2 text-xs font-medium transition ${
                draft.schedule === preset.value
                  ? 'border-accent-primary bg-accent-primary text-canvas'
                  : 'border-hairline text-muted hover:bg-white/5 hover:text-primary'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <input
          value={draft.schedule}
          onChange={(event) => onChange((current) => ({ ...current, schedule: event.target.value }))}
          className="mt-2 h-9 w-full rounded-md border border-hairline bg-canvas px-3 text-sm text-primary outline-none placeholder:text-muted focus:border-accent-primary"
          placeholder="0 9 * * 1-5"
        />
      </div>

      <label className="mt-3 block text-xs font-medium text-muted">
        Agent
        <select
          value={draft.agentId}
          onChange={(event) =>
            onChange((current) => ({ ...current, agentId: event.target.value as SupportedAgentId }))
          }
          className="mt-1 h-9 w-full rounded-md border border-hairline bg-canvas px-3 text-sm text-primary outline-none focus:border-accent-primary"
        >
          {agentOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={saving || !draft.name.trim() || !draft.prompt.trim() || !draft.schedule.trim()}
        className="mt-4 h-9 w-full rounded-md bg-accent-primary px-3 text-sm font-semibold text-canvas transition hover:bg-accent-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Create'}
      </button>
    </form>
  )
}

function AutomationRow({
  automation,
  selected,
  running,
  latestRun,
  onSelect,
  onToggle,
  onRun,
  onDelete,
}: {
  automation: Automation
  selected: boolean
  running: boolean
  latestRun?: AutomationRun
  onSelect: (id: string) => void
  onToggle: (automation: Automation) => void
  onRun: (automation: Automation) => void
  onDelete: (automation: Automation) => void
}) {
  return (
    <article
      className={`grid cursor-pointer gap-3 border-b border-hairline px-4 py-4 last:border-b-0 lg:grid-cols-[1fr_auto] ${
        selected ? 'bg-white/5' : 'hover:bg-card/50'
      }`}
      onClick={() => onSelect(automation.id)}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="truncate text-sm font-semibold text-primary">{automation.name}</h4>
          <StatusBadge label={automation.status} tone={automation.status} />
          {automation.hasUnreadRuns ? <StatusBadge label={`${automation.unreadRunCount} unread`} tone="unread" /> : null}
        </div>
        <div className="mt-1 text-xs text-muted">
          {automation.schedule} · {automation.agentId} · Next {formatDate(automation.nextRunAt)}
        </div>
        <div className="mt-1 text-xs text-muted">
          Last run {formatDate(automation.lastRunAt)}
          {latestRun ? ` · Latest ${latestRun.status}` : ''}
        </div>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{automation.prompt}</p>
      </div>

      <div className="flex flex-wrap items-start gap-2 lg:justify-end">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            void onToggle(automation)
          }}
          className="rounded-md border border-hairline px-3 py-2 text-xs font-medium text-secondary transition hover:bg-white/5"
        >
          {automation.enabled ? 'Disable' : 'Enable'}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            void onRun(automation)
          }}
          disabled={running}
          className="rounded-md border border-accent-primary/40 bg-accent-primary/10 px-3 py-2 text-xs font-medium text-accent-primary transition hover:bg-accent-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? 'Running...' : 'Run now'}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            void onDelete(automation)
          }}
          className="rounded-md border border-accent-del/40 px-3 py-2 text-xs font-medium text-accent-del transition hover:bg-accent-del/15"
        >
          Delete
        </button>
      </div>
    </article>
  )
}

function RunList({
  runs,
  automations,
  busyRunId,
  onAcknowledge,
  onReview,
  onRetry,
}: {
  runs: AutomationRun[]
  automations: Automation[]
  busyRunId: string | null
  onAcknowledge: (run: AutomationRun) => void
  onReview: (run: AutomationRun) => void
  onRetry: (run: AutomationRun) => void
}) {
  if (runs.length === 0) return <EmptyState message="No runs in this section." />

  return (
    <div className="divide-y divide-hairline">
      {runs.map((run) => {
        const automation = automations.find((item) => item.id === run.automationId)
        return (
          <div key={run.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold text-primary">
                  {automation?.name ?? 'Deleted automation'}
                </span>
                <StatusBadge label={run.status} tone={run.status} />
                {run.unread ? <StatusBadge label="unread" tone="unread" /> : null}
              </div>
              <div className="mt-1 text-xs text-muted">
                {run.trigger} · attempt {run.attempt} · started {formatDate(run.startedAt ?? run.createdAt)}
              </div>
              {run.error ? <p className="mt-2 text-sm text-accent-del">{run.error}</p> : null}
            </div>

            <div className="flex flex-wrap items-start gap-2 lg:justify-end">
              <RunButton disabled={busyRunId === run.id || !run.unread} onClick={() => onAcknowledge(run)}>
                Ack
              </RunButton>
              <RunButton disabled={busyRunId === run.id || run.reviewState === 'reviewed'} onClick={() => onReview(run)}>
                Review
              </RunButton>
              <RunButton disabled={busyRunId === run.id || run.status === 'running'} onClick={() => onRetry(run)}>
                Retry
              </RunButton>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AutomationDetail({ automation, runs }: { automation?: Automation; runs: AutomationRun[] }) {
  return (
    <aside className="h-fit rounded-md border border-hairline bg-card/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-primary">Automation Detail</h3>
        <span className="text-xs text-muted">{automation ? 'selected' : 'none'}</span>
      </div>
      {automation ? (
        <div className="space-y-4">
          <div>
            <div className="text-[11px] font-medium uppercase text-muted">Prompt</div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-secondary">
              {automation.prompt}
            </p>
          </div>
          <div className="grid gap-3 text-sm">
            <DetailMetric label="Schedule" value={automation.schedule} mono />
            <DetailMetric label="Next run" value={formatDate(automation.nextRunAt)} />
            <DetailMetric label="Review state" value={automation.reviewState} />
          </div>
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase text-muted">Run history</div>
            {runs.length > 0 ? (
              <div className="divide-y divide-hairline">
                {runs.slice(0, 8).map((run) => (
                  <div key={run.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-secondary">{run.status}</div>
                      <div className="text-xs text-muted">{run.trigger}</div>
                    </div>
                    <div className="shrink-0 text-xs tabular-nums text-muted">
                      {formatDate(run.completedAt ?? run.startedAt ?? run.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No runs yet." />
            )}
          </div>
        </div>
      ) : (
        <EmptyState message="Select an automation to inspect it." />
      )}
    </aside>
  )
}

function InboxSection({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-md border border-hairline bg-card/60">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <h3 className="text-sm font-semibold text-primary">{title}</h3>
        <span className="text-xs text-muted">{count}</span>
      </div>
      {children}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-hairline bg-card/60 px-3 py-2">
      <div className="text-sm font-semibold text-primary">{value}</div>
      <div className="mt-0.5 text-[11px] uppercase text-muted">{label}</div>
    </div>
  )
}

function DetailMetric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-hairline bg-canvas px-3 py-2">
      <div className="text-[11px] uppercase text-muted">{label}</div>
      <div className={`mt-1 text-xs text-secondary ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}

function StatusBadge({ label, tone }: { label: string; tone: string }) {
  const toneClass =
    tone === 'failed' || tone === 'cancelled' || tone === 'invalid' || tone === 'overdue'
      ? 'bg-accent-del/15 text-accent-del'
      : tone === 'succeeded' || tone === 'reviewed' || tone === 'scheduled'
        ? 'bg-accent-add/15 text-accent-add'
        : tone === 'running' || tone === 'queued' || tone === 'due'
          ? 'bg-accent-primary/15 text-accent-primary'
          : 'bg-card-raised text-muted'

  return <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${toneClass}`}>{label}</span>
}

function RunButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void onClick()}
      className="rounded-md border border-hairline px-3 py-2 text-xs font-medium text-secondary transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function Callout({ tone, children }: { tone: 'error' | 'success'; children: React.ReactNode }) {
  const className =
    tone === 'error'
      ? 'border-accent-del/40 bg-accent-del/10 text-accent-del'
      : 'border-accent-add/40 bg-accent-add/10 text-accent-add'

  return <div className={`rounded-md border px-4 py-3 text-sm ${className}`}>{children}</div>
}

export default AutomationManager
