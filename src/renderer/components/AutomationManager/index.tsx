import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentId, Automation, Project } from '../../../shared/types'

type AutomationManagerProps = {
  project: Pick<Project, 'id' | 'name'> | null
}

type AutomationDraft = {
  name: string
  prompt: string
  schedule: string
  agentId: AgentId
}

const agentOptions: Array<{ label: string; value: AgentId }> = [
  { label: 'Claude Code', value: 'claude-code' },
  { label: 'Codex', value: 'codex' },
  { label: 'OpenCode', value: 'opencode' },
]

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
  if (!timestamp) {
    return 'Never'
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function sortAutomations(automations: Automation[]): Automation[] {
  return [...automations].sort((a, b) => {
    const aTime = a.lastRunAt ?? a.createdAt
    const bTime = b.lastRunAt ?? b.createdAt

    return bTime - aTime
  })
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
      {message}
    </div>
  )
}

export function AutomationManager({ project }: AutomationManagerProps) {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [draft, setDraft] = useState<AutomationDraft>(initialDraft)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null)

  const loadAutomations = useCallback(async () => {
    if (!project) {
      setAutomations([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const nextAutomations = await window.agentforge.automations.list(project.id)
      setAutomations(sortAutomations(nextAutomations ?? []))
    } catch (reason) {
      setAutomations([])
      setError(reason instanceof Error ? reason.message : 'Unable to load automations.')
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => {
    setNotice(null)
    setDraft(initialDraft)
    void loadAutomations()
  }, [loadAutomations])

  const recentRuns = useMemo(
    () =>
      automations
        .filter((automation) => automation.lastRunAt)
        .sort((a, b) => Number(b.lastRunAt ?? 0) - Number(a.lastRunAt ?? 0))
        .slice(0, 5),
    [automations],
  )
  const selectedAutomation = useMemo(
    () => automations.find((automation) => automation.id === selectedAutomationId) ?? automations[0],
    [automations, selectedAutomationId],
  )

  async function createAutomation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!project || !draft.name.trim() || !draft.prompt.trim() || !draft.schedule.trim()) {
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      const created = (await window.agentforge.automations.create({
        projectId: project.id,
        name: draft.name.trim(),
        prompt: draft.prompt.trim(),
        schedule: draft.schedule.trim(),
        agentId: draft.agentId,
        enabled: true,
      })) as Automation | null

      if (created) {
        setAutomations((current) => sortAutomations([created, ...current]))
        setSelectedAutomationId(created.id)
      } else {
        await loadAutomations()
      }

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
      const updated = (await window.agentforge.automations.update(automation.id, {
        enabled,
      })) as Automation | null

      if (updated) {
        setAutomations((current) =>
          sortAutomations(current.map((item) => (item.id === automation.id ? updated : item))),
        )
      }
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
    setRunningId(automation.id)
    setError(null)
    setNotice(null)

    try {
      const result = await window.agentforge.automations.runNow(automation.id)
      const lastRunAt = Date.now()

      setAutomations((current) =>
        sortAutomations(
          current.map((item) =>
            item.id === automation.id ? { ...item, lastRunAt } : item,
          ),
        ),
      )
      setNotice(`Session ${result.sessionId} started.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to run automation.')
    } finally {
      setRunningId(null)
    }
  }

  async function deleteAutomation(automation: Automation) {
    setError(null)
    setNotice(null)

    const previousAutomations = automations
    setAutomations((current) => current.filter((item) => item.id !== automation.id))

    try {
      await window.agentforge.automations.delete(automation.id)
      if (selectedAutomationId === automation.id) {
        setSelectedAutomationId(null)
      }
      setNotice('Automation deleted.')
    } catch (reason) {
      setAutomations(previousAutomations)
      setError(reason instanceof Error ? reason.message : 'Unable to delete automation.')
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-zinc-100">Automation Manager</h2>
          <div className="mt-1 truncate text-xs text-zinc-500">
            {project ? project.name : 'No project selected'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadAutomations()}
          disabled={!project || loading}
          className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Refresh
        </button>
      </header>

      <div className="grid min-h-0 flex-1 gap-5 overflow-auto p-5 xl:grid-cols-[22rem_1fr]">
        {!project ? (
          <div className="xl:col-span-2">
            <EmptyState message="Select a project to manage automations." />
          </div>
        ) : (
          <>
            <form
              onSubmit={(event) => void createAutomation(event)}
              className="h-fit rounded-md border border-zinc-800 bg-zinc-900/60 p-4"
            >
              <h3 className="text-sm font-semibold text-zinc-100">New Automation</h3>

              <label className="mt-4 block text-xs font-medium text-zinc-400">
                Name
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  className="mt-1 h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-500"
                  placeholder="Daily review"
                />
              </label>

              <label className="mt-3 block text-xs font-medium text-zinc-400">
                Prompt
                <textarea
                  value={draft.prompt}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, prompt: event.target.value }))
                  }
                  className="mt-1 h-28 w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-500"
                  placeholder="Review open work and report risks."
                />
              </label>

              <div className="mt-3">
                <div className="mb-2 text-xs font-medium text-zinc-400">Schedule</div>
                <div className="grid grid-cols-3 gap-2">
                  {schedulePresets.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setDraft((current) => ({ ...current, schedule: preset.value }))}
                      className={`rounded-md border px-2 py-2 text-xs font-medium transition ${
                        draft.schedule === preset.value
                          ? 'border-cyan-400 bg-cyan-400 text-zinc-950'
                          : 'border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <input
                  value={draft.schedule}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, schedule: event.target.value }))
                  }
                  className="mt-2 h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-500"
                  placeholder="0 9 * * 1-5"
                />
              </div>

              <label className="mt-3 block text-xs font-medium text-zinc-400">
                Agent
                <select
                  value={draft.agentId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      agentId: event.target.value as AgentId,
                    }))
                  }
                  className="mt-1 h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-500"
                >
                  {agentOptions.map((agent) => (
                    <option key={agent.value} value={agent.value}>
                      {agent.label}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                disabled={saving || !draft.name.trim() || !draft.prompt.trim() || !draft.schedule.trim()}
                className="mt-4 h-9 w-full rounded-md bg-cyan-400 px-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Create'}
              </button>
            </form>

            <div className="min-w-0 space-y-5">
              {error ? (
                <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}
              {notice ? (
                <div className="rounded-md border border-emerald-900/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
                  {notice}
                </div>
              ) : null}

              <section className="rounded-md border border-zinc-800 bg-zinc-900/60">
                <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
                  <h3 className="text-sm font-semibold text-zinc-100">Automations</h3>
                  <span className="text-xs text-zinc-500">{automations.length} total</span>
                </div>

                {loading ? (
                  <div className="p-4">
                    <EmptyState message="Loading automations..." />
                  </div>
                ) : automations.length > 0 ? (
                  <div className="divide-y divide-zinc-800">
                    {automations.map((automation) => (
                      <article
                        key={automation.id}
                        className={`grid cursor-pointer gap-3 px-4 py-4 lg:grid-cols-[1fr_auto] ${
                          selectedAutomation?.id === automation.id ? 'bg-zinc-800/50' : 'hover:bg-zinc-900/50'
                        }`}
                        onClick={() => setSelectedAutomationId(automation.id)}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="truncate text-sm font-semibold text-zinc-100">
                              {automation.name}
                            </h4>
                            <span
                              className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                                automation.enabled
                                  ? 'bg-emerald-400/15 text-emerald-300'
                                  : 'bg-zinc-800 text-zinc-400'
                              }`}
                            >
                              {automation.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {automation.schedule} · {automation.agentId} · Last run{' '}
                            {formatDate(automation.lastRunAt)}
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-400">
                            {automation.prompt}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                          <button
                            type="button"
                            onClick={() => void toggleAutomation(automation)}
                            className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
                          >
                            {automation.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void runAutomation(automation)}
                            disabled={runningId === automation.id}
                            className="rounded-md border border-cyan-800 bg-cyan-950/40 px-3 py-2 text-xs font-medium text-cyan-200 transition hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {runningId === automation.id ? 'Running...' : 'Run now'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteAutomation(automation)}
                            className="rounded-md border border-red-900/70 px-3 py-2 text-xs font-medium text-red-200 transition hover:bg-red-950/50"
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="p-4">
                    <EmptyState message="No automations for this project." />
                  </div>
                )}
              </section>

              <section className="rounded-md border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-zinc-100">Automation Detail</h3>
                  <span className="text-xs text-zinc-500">
                    {selectedAutomation ? 'selected' : 'none'}
                  </span>
                </div>
                {selectedAutomation ? (
                  <div className="space-y-4">
                    <div>
                      <div className="text-[11px] font-medium uppercase text-zinc-500">Prompt</div>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
                        {selectedAutomation.prompt}
                      </p>
                    </div>
                    <div className="grid gap-3 text-sm sm:grid-cols-3">
                      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                        <div className="text-[11px] uppercase text-zinc-500">Schedule</div>
                        <div className="mt-1 font-mono text-xs text-zinc-200">{selectedAutomation.schedule}</div>
                      </div>
                      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                        <div className="text-[11px] uppercase text-zinc-500">Agent</div>
                        <div className="mt-1 text-xs text-zinc-200">{selectedAutomation.agentId}</div>
                      </div>
                      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                        <div className="text-[11px] uppercase text-zinc-500">Last run</div>
                        <div className="mt-1 text-xs text-zinc-200">{formatDate(selectedAutomation.lastRunAt)}</div>
                      </div>
                    </div>
                    {recentRuns.length > 0 ? (
                      <div>
                        <div className="mb-2 text-[11px] font-medium uppercase text-zinc-500">
                          Recent runs
                        </div>
                        <div className="divide-y divide-zinc-800">
                          {recentRuns.map((automation) => (
                            <div
                              key={`${automation.id}-${automation.lastRunAt}`}
                              className="flex items-center justify-between gap-3 py-2"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm text-zinc-200">{automation.name}</div>
                                <div className="text-xs text-zinc-500">{automation.agentId}</div>
                              </div>
                              <div className="shrink-0 text-xs tabular-nums text-zinc-400">
                                {formatDate(automation.lastRunAt)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <EmptyState message="Select an automation to inspect it." />
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

export default AutomationManager
