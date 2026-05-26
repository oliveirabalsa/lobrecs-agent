import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { AGENT_LABELS } from '../../../../shared/types'
import type {
  AdapterCapability,
  AgentProfile,
  CreateSpecInput,
  Project,
  RunAuditPhase,
  RunAuditRecord,
  RunMode,
  Spec,
  SpecArtifact,
  SpecSettings,
  SpecRun,
  SpecRunComparison,
  SupportedAgentId,
  VerificationRecipe,
} from '../../../../shared/types'
import { MarkdownContent } from '../../workspace/components/MarkdownContent'

interface SpecWorkbenchProps {
  project: Project
}

type SpecDraft = {
  title: string
  goal: string
  context: string
  constraints: string
  doneWhen: string
  targetFiles: string
  requirements: string
  acceptanceCriteria: string
  selectedAgents: SupportedAgentId[]
  selectedAgentProfiles: string[]
  runMode: RunMode
}

type WorkbenchTab = 'details' | 'artifacts'

const emptyDraft: SpecDraft = {
  title: '',
  goal: '',
  context: '',
  constraints: '',
  doneWhen: '',
  targetFiles: '',
  requirements: '',
  acceptanceCriteria: '',
  selectedAgents: ['codex'],
  selectedAgentProfiles: [],
  runMode: 'local',
}

const phaseLabels = ['Intake', 'Plan', 'Agent Runs', 'Review', 'Verify', 'Ship']

const statusStyles: Record<Spec['status'], string> = {
  draft: 'border-zinc-700 bg-zinc-900 text-zinc-300',
  approved: 'border-blue-500/40 bg-blue-500/10 text-blue-200',
  running: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  reviewing: 'border-violet-500/40 bg-violet-500/10 text-violet-200',
  verified: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  failed: 'border-red-500/40 bg-red-500/10 text-red-200',
}

export function SpecWorkbench({ project }: SpecWorkbenchProps) {
  const [specs, setSpecs] = useState<Spec[]>([])
  const [selectedSpecId, setSelectedSpecId] = useState<string | null>(null)
  const [draft, setDraft] = useState<SpecDraft>(emptyDraft)
  const [capabilities, setCapabilities] = useState<AdapterCapability[]>([])
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [profileIssues, setProfileIssues] = useState(0)
  const [recipes, setRecipes] = useState<VerificationRecipe[]>([])
  const [specSettings, setSpecSettings] = useState<SpecSettings | null>(null)
  const [comparison, setComparison] = useState<SpecRunComparison | null>(null)
  const [auditRecords, setAuditRecords] = useState<RunAuditRecord[]>([])
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('details')
  const [artifacts, setArtifacts] = useState<SpecArtifact[]>([])
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  const [artifactMarkdown, setArtifactMarkdown] = useState('')
  const [artifactsLoading, setArtifactsLoading] = useState(false)
  const [artifactSaving, setArtifactSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [running, setRunning] = useState(false)
  const [verifyingCommand, setVerifyingCommand] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedSpec = useMemo(
    () => specs.find((spec) => spec.id === selectedSpecId) ?? null,
    [selectedSpecId, specs],
  )
  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null,
    [artifacts, selectedArtifactId],
  )
  const latestRun = useMemo(
    () => [...(comparison?.runs ?? [])].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
    [comparison],
  )
  const selectedAgents = useMemo(
    () =>
      capabilities.length > 0
        ? capabilities
        : fallbackCapabilities(project.agentId),
    [capabilities, project.agentId],
  )

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      setNotice(null)
      setComparison(null)

      try {
        const [loadedSpecs, loadedCapabilities, loadedRecipes, effectiveSettings, profileResult] = await Promise.all([
          window.agentforge.specs.list(project.id),
          window.agentforge.system.listCapabilities(),
          window.agentforge.system.listVerificationRecipes(project.id),
          window.agentforge.settings.getEffective(project.id),
          window.agentforge.agent.listProfiles(project.id),
        ])
        if (cancelled) return

        setSpecs(loadedSpecs)
        setCapabilities(loadedCapabilities)
        setProfiles(profileResult.profiles)
        setProfileIssues(profileResult.issues.length)
        setRecipes(loadedRecipes)
        setSpecSettings(effectiveSettings.settings.specs)
        setSelectedSpecId((current) => current ?? loadedSpecs[0]?.id ?? null)
        if (loadedSpecs.length === 0) {
          setDraft({
            ...emptyDraft,
            selectedAgents: defaultSpecAgents(effectiveSettings.settings.specs, project),
            selectedAgentProfiles: [],
          })
        }
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Failed to load specs')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [project.agentId, project.id])

  useEffect(() => {
    if (!selectedSpec) return
    setDraft(draftFromSpec(selectedSpec))
    void refreshComparison(selectedSpec.id)
  }, [selectedSpec])

  useEffect(() => {
    if (!selectedSpec || activeTab !== 'artifacts') return
    void refreshArtifacts(selectedSpec.id)
  }, [activeTab, selectedSpec])

  useEffect(() => {
    setArtifactMarkdown(selectedArtifact?.markdown ?? '')
  }, [selectedArtifact])

  async function refreshSpecs(nextSelectedId?: string) {
    const loadedSpecs = await window.agentforge.specs.list(project.id)
    setSpecs(loadedSpecs)
    setSelectedSpecId(nextSelectedId ?? selectedSpecId ?? loadedSpecs[0]?.id ?? null)
  }

  async function refreshComparison(specId: string) {
    const nextComparison = await window.agentforge.runs.compare(specId)
    setComparison(nextComparison)

    const latest = [...nextComparison.runs].sort((a, b) => b.createdAt - a.createdAt)[0]
    if (latest) {
      try {
        const records = await window.agentforge.runs.listAuditRecords(latest.id)
        setAuditRecords(records)
      } catch {
        setAuditRecords([])
      }
    } else {
      setAuditRecords([])
    }
  }

  async function refreshArtifacts(specId: string, nextSelectedId?: string) {
    setArtifactsLoading(true)
    setError(null)

    try {
      const loadedArtifacts = await window.agentforge.specs.listArtifacts(specId)
      setArtifacts(loadedArtifacts)
      setSelectedArtifactId((current) => {
        if (nextSelectedId && loadedArtifacts.some((artifact) => artifact.id === nextSelectedId)) {
          return nextSelectedId
        }
        if (current && loadedArtifacts.some((artifact) => artifact.id === current)) return current
        return loadedArtifacts[0]?.id ?? null
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load workflow artifacts')
    } finally {
      setArtifactsLoading(false)
    }
  }

  async function saveArtifact() {
    if (!selectedSpec || !selectedArtifact) return

    setArtifactSaving(true)
    setError(null)
    setNotice(null)

    try {
      const saved = await window.agentforge.specs.writeArtifact({
        specId: selectedSpec.id,
        artifactId: selectedArtifact.id,
        kind: selectedArtifact.kind,
        title: selectedArtifact.title,
        markdown: artifactMarkdown,
      })
      await refreshArtifacts(selectedSpec.id, saved.id)
      setNotice(`${saved.title} saved to ${saved.relativePath}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to save workflow artifact')
    } finally {
      setArtifactSaving(false)
    }
  }

  async function createReviewArtifact() {
    if (!selectedSpec) return

    setArtifactSaving(true)
    setError(null)
    setNotice(null)

    try {
      const reviewCount = artifacts.filter((artifact) => artifact.kind === 'review').length + 1
      const saved = await window.agentforge.specs.writeArtifact({
        specId: selectedSpec.id,
        kind: 'review',
        title: `Review Round ${reviewCount}`,
        markdown: `# Review Round ${reviewCount}\n\n## Findings\n\n- `,
      })
      await refreshArtifacts(selectedSpec.id, saved.id)
      setActiveTab('artifacts')
      setNotice(`Review artifact created at ${saved.relativePath}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to create review artifact')
    } finally {
      setArtifactSaving(false)
    }
  }

  async function suggestDraft() {
    if (!draft.title.trim() || !draft.goal.trim()) return

    setSuggesting(true)
    setError(null)
    setNotice(null)

    try {
      const suggestion = await window.agentforge.specs.suggestDraft(
        project.id,
        draft.title,
        draft.goal,
      )

      setDraft((prev) => ({
        ...prev,
        constraints: suggestion.constraints,
        requirements: suggestion.requirements.join('\n'),
        acceptanceCriteria: suggestion.acceptanceCriteria.join('\n'),
        targetFiles: suggestion.targetFiles.join('\n'),
      }))

      setNotice('AI spec draft generated successfully.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to suggest spec draft')
    } finally {
      setSuggesting(false)
    }
  }

  async function saveSpec(event?: FormEvent) {
    event?.preventDefault()
    if (!draft.title.trim() || !draft.goal.trim()) return

    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      const payload = inputFromDraft(project.id, draft)
      const saved = selectedSpec
        ? await window.agentforge.specs.update(selectedSpec.id, payload)
        : await window.agentforge.specs.create(payload)

      await refreshSpecs(saved.id)
      setNotice(selectedSpec ? 'Spec updated.' : 'Spec created.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to save spec')
    } finally {
      setSaving(false)
    }
  }

  async function approveSpec() {
    if (!selectedSpec) return

    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      const approved = await window.agentforge.specs.approve(selectedSpec.id)
      await refreshSpecs(approved.id)
      setNotice('Spec approved for execution.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to approve spec')
    } finally {
      setSaving(false)
    }
  }

  async function startRun() {
    if (!selectedSpec || selectedSpec.status === 'draft') return

    setRunning(true)
    setError(null)
    setNotice(null)

    try {
      const result = await window.agentforge.runs.start({
        specId: selectedSpec.id,
        mode: 'local',
      })
      await refreshSpecs(selectedSpec.id)
      await refreshComparison(selectedSpec.id)
      setNotice(`${result.attempts.length} agent run${result.attempts.length === 1 ? '' : 's'} started.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to start spec run')
    } finally {
      setRunning(false)
    }
  }

  async function verifyRun(recipe: VerificationRecipe) {
    if (!latestRun) return

    setVerifyingCommand(recipe.command)
    setError(null)
    setNotice(null)

    try {
      const result = await window.agentforge.runs.verify(latestRun.id, recipe.command)
      if (selectedSpecId) {
        await refreshSpecs(selectedSpecId)
        await refreshComparison(selectedSpecId)
      }
      setNotice(`Verification ${result.status}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Verification failed to run')
    } finally {
      setVerifyingCommand(null)
    }
  }

  function newSpec() {
    setSelectedSpecId(null)
    setComparison(null)
    setArtifacts([])
    setSelectedArtifactId(null)
    setArtifactMarkdown('')
    setActiveTab('details')
    setDraft({
      ...emptyDraft,
      selectedAgents: defaultSpecAgents(specSettings, project),
    })
    setError(null)
    setNotice(null)
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Spec Workbench</h2>
            <p className="mt-1 truncate text-xs text-zinc-500">{project.name}</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedSpec ? (
              <span className={`rounded border px-2.5 py-1 text-xs font-medium ${statusStyles[selectedSpec.status]}`}>
                {selectedSpec.status}
              </span>
            ) : null}
            <button
              type="button"
              onClick={newSpec}
              className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              New spec
            </button>
          </div>
        </div>
        <div className="mt-4 flex gap-1 rounded-md border border-zinc-800 bg-zinc-900/70 p-1">
          {[
            { id: 'details' as const, label: 'Spec' },
            { id: 'artifacts' as const, label: 'Artifacts' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition ${
                activeTab === tab.id
                  ? 'bg-zinc-100 text-zinc-950'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {phaseLabels.map((label, index) => (
            <div
              key={label}
              className={`rounded-md border px-3 py-2 text-xs ${
                phaseIndex(selectedSpec, latestRun) >= index
                  ? 'border-blue-500/40 bg-blue-500/10 text-blue-100'
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-500'
              }`}
            >
              <div className="font-semibold">{label}</div>
            </div>
          ))}
        </div>
      </header>

      {error ? (
        <div className="border-b border-red-900/70 bg-red-950/50 px-5 py-2 text-xs text-red-200">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="border-b border-emerald-900/70 bg-emerald-950/30 px-5 py-2 text-xs text-emerald-200">
          {notice}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[20rem_minmax(0,1fr)_22rem]">
        <aside className="min-h-[220px] border-b border-zinc-800 bg-zinc-950 xl:min-h-0 xl:border-b-0 xl:border-r">
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-zinc-800 px-4 py-3 text-xs font-semibold uppercase text-zinc-500">
              Specs
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {loading ? (
                <SpecListSkeleton />
              ) : specs.length === 0 ? (
                <div className="rounded-md border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-zinc-500">
                  No specs yet.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {specs.map((spec) => (
                    <button
                      key={spec.id}
                      type="button"
                      onClick={() => setSelectedSpecId(spec.id)}
                      className={`rounded-md border px-3 py-3 text-left transition ${
                        spec.id === selectedSpecId
                          ? 'border-blue-500/50 bg-blue-500/10'
                          : 'border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900'
                      }`}
                    >
                      <div className="line-clamp-2 text-sm font-medium text-zinc-100">
                        {spec.title}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                        <span className={`rounded border px-1.5 py-0.5 ${statusStyles[spec.status]}`}>
                          {spec.status}
                        </span>
                        <span className="text-zinc-500">{spec.selectedAgents.length} agents</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>

        {activeTab === 'details' ? (
          <form onSubmit={(event) => void saveSpec(event)} className="min-h-0 overflow-auto">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-5">
            <Field label="Title">
              <input
                value={draft.title}
                onChange={(event) => setDraftField('title', event.target.value, setDraft)}
                className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-blue-500"
                placeholder="Concise execution contract"
              />
            </Field>

            <Field label="Goal">
              <textarea
                value={draft.goal}
                onChange={(event) => setDraftField('goal', event.target.value, setDraft)}
                className="min-h-24 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none focus:border-blue-500"
                placeholder="What should be true when this is done?"
              />
            </Field>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <span className="text-xs text-zinc-400">
                Provide a Title and Goal first, then let the AI draft constraints, requirements, criteria, and target files.
              </span>
              <button
                type="button"
                disabled={!draft.title.trim() || !draft.goal.trim() || suggesting}
                onClick={suggestDraft}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:pointer-events-none disabled:opacity-40"
              >
                {suggesting ? (
                  <>
                    <svg className="h-3.5 w-3.5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>Suggesting...</span>
                  </>
                ) : (
                  <>
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    <span>Draft with AI</span>
                  </>
                )}
              </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Context">
                <textarea
                  value={draft.context}
                  onChange={(event) => setDraftField('context', event.target.value, setDraft)}
                  className="min-h-28 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none focus:border-blue-500"
                />
              </Field>
              <Field label="Constraints">
                <textarea
                  value={draft.constraints}
                  onChange={(event) => setDraftField('constraints', event.target.value, setDraft)}
                  className="min-h-28 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none focus:border-blue-500"
                />
              </Field>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Requirements">
                <textarea
                  value={draft.requirements}
                  onChange={(event) => setDraftField('requirements', event.target.value, setDraft)}
                  className="min-h-32 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none focus:border-blue-500"
                  placeholder="One requirement per line"
                />
              </Field>
              <Field label="Acceptance Criteria">
                <textarea
                  value={draft.acceptanceCriteria}
                  onChange={(event) =>
                    setDraftField('acceptanceCriteria', event.target.value, setDraft)
                  }
                  className="min-h-32 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none focus:border-blue-500"
                  placeholder="One criterion per line"
                />
              </Field>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Done When">
                <textarea
                  value={draft.doneWhen}
                  onChange={(event) => setDraftField('doneWhen', event.target.value, setDraft)}
                  className="min-h-24 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none focus:border-blue-500"
                />
              </Field>
              <Field label="Target Files">
                <textarea
                  value={draft.targetFiles}
                  onChange={(event) => setDraftField('targetFiles', event.target.value, setDraft)}
                  className="min-h-24 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none focus:border-blue-500"
                  placeholder="One path per line"
                />
              </Field>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_14rem]">
              <Field label="Agents">
                {profiles.length > 0 ? (
                  <div className="mb-3 rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase text-zinc-500">
                        Profiles
                      </span>
                      {profileIssues > 0 ? (
                        <span className="text-[11px] text-amber-300">
                          {profileIssues} doctor issue{profileIssues === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {profiles.map((profile) => {
                        const selected = draft.selectedAgentProfiles.includes(profile.id)
                        return (
                          <button
                            key={profile.id}
                            type="button"
                            onClick={() => toggleProfile(profile, profiles, setDraft)}
                            className={`rounded-md border px-3 py-1.5 text-xs transition ${
                              selected
                                ? 'border-blue-500/50 bg-blue-500/10 text-blue-100'
                                : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900'
                            }`}
                          >
                            {profile.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-3">
                  {selectedAgents.map((capability) => (
                    <label
                      key={capability.agentId}
                      className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
                        draft.selectedAgents.includes(capability.agentId)
                          ? 'border-blue-500/50 bg-blue-500/10 text-blue-100'
                          : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                      }`}
                    >
                      <span>
                        <span className="block font-medium">{capability.name}</span>
                        <span className="block text-[11px] text-zinc-500">
                          {capability.installed ? 'installed' : 'not installed'}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={draft.selectedAgents.includes(capability.agentId)}
                        onChange={() => toggleAgent(capability.agentId, setDraft)}
                      />
                    </label>
                  ))}
                </div>
              </Field>

              <Field label="Run Mode">
                <div className="flex h-10 items-center rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100">
                  Local
                </div>
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-4">
              <button
                type="submit"
                disabled={saving || !draft.title.trim() || !draft.goal.trim()}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving...' : selectedSpec ? 'Save Draft' : 'Create Spec'}
              </button>
              <button
                type="button"
                onClick={() => void approveSpec()}
                disabled={!selectedSpec || saving || selectedSpec.status === 'approved'}
                className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => void startRun()}
                disabled={!selectedSpec || selectedSpec.status === 'draft' || running}
                className="rounded-md border border-emerald-700/60 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-950/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? 'Starting...' : 'Start Run'}
              </button>
            </div>
            </div>
          </form>
        ) : (
          <ArtifactsPanel
            artifacts={artifacts}
            loading={artifactsLoading}
            selectedArtifact={selectedArtifact}
            markdown={artifactMarkdown}
            saving={artifactSaving}
            disabled={!selectedSpec}
            onSelect={setSelectedArtifactId}
            onChange={setArtifactMarkdown}
            onSave={() => void saveArtifact()}
            onCreateReview={() => void createReviewArtifact()}
          />
        )}

        <aside className="min-h-[320px] border-t border-zinc-800 bg-zinc-950 xl:min-h-0 xl:border-l xl:border-t-0">
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h3 className="text-sm font-semibold text-zinc-100">Run Review</h3>
              <p className="mt-1 text-xs text-zinc-500">Attempts, verification, and ship checks.</p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <RunSummary comparison={comparison} latestRun={latestRun} />

              <div className="mt-5">
                <div className="text-xs font-semibold uppercase text-zinc-500">Verification</div>
                <div className="mt-2 flex flex-col gap-2">
                  {recipes.map((recipe) => (
                    <button
                      key={recipe.id}
                      type="button"
                      onClick={() => void verifyRun(recipe)}
                      disabled={!latestRun || verifyingCommand !== null}
                      className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="block font-medium">{recipe.label}</span>
                      <span className="mt-1 block truncate text-zinc-500">
                        {verifyingCommand === recipe.command ? 'Running...' : recipe.command}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <AuditTimeline records={auditRecords} />

              <div className="mt-5 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-3">
                <div className="text-xs font-semibold uppercase text-zinc-500">Ship Gate</div>
                <div className="mt-2 text-sm text-zinc-300">
                  {selectedSpec?.status === 'verified'
                    ? 'Verified. Review the generated diff before applying or committing.'
                    : 'A spec must be approved, run, reviewed, and verified before shipping.'}
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}

function ArtifactsPanel({
  artifacts,
  loading,
  selectedArtifact,
  markdown,
  saving,
  disabled,
  onSelect,
  onChange,
  onSave,
  onCreateReview,
}: {
  artifacts: SpecArtifact[]
  loading: boolean
  selectedArtifact: SpecArtifact | null
  markdown: string
  saving: boolean
  disabled: boolean
  onSelect: (artifactId: string) => void
  onChange: (markdown: string) => void
  onSave: () => void
  onCreateReview: () => void
}) {
  return (
    <div className="grid min-h-0 overflow-hidden lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="min-h-[180px] border-b border-zinc-800 bg-zinc-950/80 p-3 lg:min-h-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase text-zinc-500">Artifacts</div>
          <button
            type="button"
            onClick={onCreateReview}
            disabled={disabled || saving}
            className="rounded border border-zinc-700 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            New review
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {loading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-md bg-zinc-900" />
            ))
          ) : artifacts.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-800 px-3 py-6 text-center text-xs text-zinc-500">
              Select a saved spec to create workflow artifacts.
            </div>
          ) : (
            artifacts.map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                onClick={() => onSelect(artifact.id)}
                className={`rounded-md border px-3 py-2 text-left transition ${
                  artifact.id === selectedArtifact?.id
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : 'border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900'
                }`}
              >
                <span className="block truncate text-sm font-medium text-zinc-100">
                  {artifact.title}
                </span>
                <span className="mt-1 block truncate text-[11px] text-zinc-500">
                  {artifactKindLabel(artifact.kind)} · v{artifact.version}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <div className="min-h-0 overflow-auto">
        {selectedArtifact ? (
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-zinc-100">
                  {selectedArtifact.title}
                </h3>
                <p className="mt-1 truncate text-xs text-zinc-500">
                  {selectedArtifact.relativePath}
                </p>
              </div>
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="rounded-md bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save artifact'}
              </button>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <label className="block min-w-0">
                <span className="mb-2 block text-xs font-semibold uppercase text-zinc-500">
                  Markdown
                </span>
                <textarea
                  value={markdown}
                  onChange={(event) => onChange(event.target.value)}
                  className="min-h-[28rem] w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs leading-6 text-zinc-100 outline-none focus:border-blue-500"
                  spellCheck={false}
                />
              </label>

              <div className="min-w-0">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase text-zinc-500">Preview</span>
                  <span className="truncate text-[11px] text-zinc-600">
                    {Object.entries(selectedArtifact.frontmatter)
                      .map(([key, value]) => `${key}:${String(value)}`)
                      .join(' · ')}
                  </span>
                </div>
                <div className="min-h-[28rem] overflow-auto rounded-md border border-zinc-800 bg-zinc-900/70 p-4">
                  <MarkdownContent text={markdown || '_Empty artifact_'} variant="assistant" />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-[320px] items-center justify-center px-4 text-sm text-zinc-500">
            No artifact selected.
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase text-zinc-500">{label}</span>
      {children}
    </label>
  )
}

function artifactKindLabel(kind: SpecArtifact['kind']): string {
  switch (kind) {
    case 'prd':
      return 'PRD'
    case 'techspec':
      return 'Tech spec'
    case 'tasks':
      return 'Tasks'
    case 'review':
      return 'Review'
    case 'memory':
      return 'Memory'
  }
}

function RunSummary({
  comparison,
  latestRun,
}: {
  comparison: SpecRunComparison | null
  latestRun: SpecRun | null
}) {
  if (!comparison || comparison.runs.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-zinc-500">
        No runs yet.
      </div>
    )
  }

  const attempts = latestRun
    ? comparison.attempts.filter((attempt) => attempt.specRunId === latestRun.id)
    : []
  const verificationResults = latestRun
    ? comparison.verificationResults.filter((result) => result.specRunId === latestRun.id)
    : []

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase text-zinc-500">Latest Run</div>
        {latestRun ? (
          <span className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300">
            {latestRun.status}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {attempts.map((attempt) => (
          <div key={attempt.id} className="rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium text-zinc-100">{attempt.agentId}</span>
              <span className="text-xs text-zinc-400">{attempt.status}</span>
            </div>
            <div className="mt-1 truncate text-xs text-zinc-500">
              {attempt.model ?? 'model pending'}
            </div>
            {attempt.sessionId ? (
              <div className="mt-1 truncate text-[11px] text-zinc-600">{attempt.sessionId}</div>
            ) : null}
          </div>
        ))}
      </div>
      {verificationResults.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          {verificationResults.map((result) => (
            <div key={result.id} className="rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium text-zinc-200">{result.command}</span>
                <span className="text-zinc-400">{result.status}</span>
              </div>
              {result.output ? (
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-zinc-500">
                  {result.output}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const phaseLabel: Record<RunAuditPhase, string> = {
  'recipe-started': 'Started',
  'recipe-passed': 'Passed',
  'recipe-failed': 'Failed',
  'visual-captured': 'Visual captured',
  'visual-failed': 'Visual failed',
  'repair-dispatched': 'Repair started',
  'repair-skipped': 'Skipped',
  'gate-passed': 'QA done',
  'gate-stopped': 'Stopped',
}

const phaseTone: Record<RunAuditPhase, string> = {
  'recipe-started': 'border-zinc-700 bg-zinc-900 text-zinc-300',
  'recipe-passed': 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  'recipe-failed': 'border-red-500/40 bg-red-500/10 text-red-200',
  'visual-captured': 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  'visual-failed': 'border-red-500/40 bg-red-500/10 text-red-200',
  'repair-dispatched': 'border-violet-500/40 bg-violet-500/10 text-violet-200',
  'repair-skipped': 'border-zinc-700 bg-zinc-900 text-zinc-400',
  'gate-passed': 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  'gate-stopped': 'border-amber-500/40 bg-amber-500/10 text-amber-200',
}

function AuditTimeline({ records }: { records: RunAuditRecord[] }) {
  if (records.length === 0) return null

  return (
    <div className="mt-5">
      <div className="text-xs font-semibold uppercase text-zinc-500">Audit Timeline</div>
      <ol className="mt-2 flex flex-col gap-2">
        {records.map((record) => (
          <li
            key={record.id}
            className={`rounded-md border px-3 py-2 text-xs ${phaseTone[record.phase]}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {phaseLabel[record.phase]}
                {record.recipeLabel ? ` · ${record.recipeLabel}` : ''}
              </span>
              <span className="text-[11px] text-zinc-500">
                attempt {record.attempt}
                {record.exitCode !== undefined ? ` · exit ${record.exitCode}` : ''}
              </span>
            </div>
            {record.command ? (
              <div className="mt-1 truncate text-[11px] text-zinc-500">{record.command}</div>
            ) : null}
            {record.stopReason ? (
              <div className="mt-1 text-[11px] text-zinc-400">stop: {record.stopReason}</div>
            ) : null}
            {record.outputTail ? (
              <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-zinc-500">
                {record.outputTail.slice(0, 600)}
              </pre>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  )
}

function SpecListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-20 animate-pulse rounded-md bg-zinc-900" />
      ))}
    </div>
  )
}

function phaseIndex(spec: Spec | null, latestRun: SpecRun | null): number {
  if (!spec) return 0
  if (spec.status === 'draft') return 1
  if (spec.status === 'approved') return 2
  if (spec.status === 'running' || latestRun?.status === 'running') return 3
  if (spec.status === 'reviewing') return 4
  if (spec.status === 'verified') return 5
  return 1
}

function inputFromDraft(projectId: string, draft: SpecDraft): CreateSpecInput {
  return {
    projectId,
    title: draft.title,
    goal: draft.goal,
    context: draft.context,
    constraints: draft.constraints,
    doneWhen: draft.doneWhen,
      targetFiles: linesFromText(draft.targetFiles),
      selectedAgents: draft.selectedAgents.length > 0 ? draft.selectedAgents : ['codex'],
      selectedAgentProfiles: draft.selectedAgentProfiles,
      runMode: 'local',
    requirements: linesFromText(draft.requirements),
    acceptanceCriteria: linesFromText(draft.acceptanceCriteria),
  }
}

function draftFromSpec(spec: Spec): SpecDraft {
  return {
    title: spec.title,
    goal: spec.goal,
    context: spec.context,
    constraints: spec.constraints,
    doneWhen: spec.doneWhen,
    targetFiles: spec.targetFiles.join('\n'),
    requirements: spec.requirements.map((item) => item.body).join('\n'),
    acceptanceCriteria: spec.acceptanceCriteria.map((item) => item.body).join('\n'),
    selectedAgents: spec.selectedAgents.length > 0 ? spec.selectedAgents : ['codex'],
    selectedAgentProfiles: spec.selectedAgentProfiles ?? [],
    runMode: 'local',
  }
}

function linesFromText(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function defaultSpecAgents(
  settings: SpecSettings | null,
  project: Project,
): SupportedAgentId[] {
  if (settings?.defaultAgentIds.length) {
    return settings.defaultAgentIds
  }

  return [project.agentId]
}

function setDraftField<K extends keyof SpecDraft>(
  key: K,
  value: SpecDraft[K],
  setDraft: Dispatch<SetStateAction<SpecDraft>>,
) {
  setDraft((current) => ({ ...current, [key]: value }))
}

function toggleAgent(
  agentId: SupportedAgentId,
  setDraft: Dispatch<SetStateAction<SpecDraft>>,
) {
  setDraft((current) => {
    const nextAgents = current.selectedAgents.includes(agentId)
      ? current.selectedAgents.filter((item) => item !== agentId)
      : [...current.selectedAgents, agentId]

    return {
      ...current,
      selectedAgents: nextAgents.length > 0 ? nextAgents : current.selectedAgents,
    }
  })
}

function toggleProfile(
  profile: AgentProfile,
  profiles: AgentProfile[],
  setDraft: Dispatch<SetStateAction<SpecDraft>>,
) {
  setDraft((current) => {
    const selected = current.selectedAgentProfiles.includes(profile.id)
    const selectedAgentProfiles = selected
      ? current.selectedAgentProfiles.filter((item) => item !== profile.id)
      : [...current.selectedAgentProfiles, profile.id]
    const profileAgents = selectedAgentProfiles
      .map((profileId) => profiles.find((item) => item.id === profileId)?.defaultAgentId)
      .filter((agentId): agentId is SupportedAgentId => Boolean(agentId))
    const manualAgents = current.selectedAgents.filter(
      (agentId) => !profileAgents.includes(agentId),
    )
    const selectedAgents = [...profileAgents, ...manualAgents]

    return {
      ...current,
      selectedAgentProfiles,
      selectedAgents: selectedAgents.length > 0 ? selectedAgents : current.selectedAgents,
    }
  })
}

function fallbackCapabilities(agentId: SupportedAgentId): AdapterCapability[] {
  const isAntigravity = agentId === 'antigravity'

  return [
    {
      agentId,
      name: AGENT_LABELS[agentId],
      installed: true,
      supportsStreamingJson: !isAntigravity,
      supportsResume: false,
      supportsFileAttachments: false,
      supportsCustomAgents: isAntigravity,
      supportsMcp: isAntigravity,
      supportsApprovalMode: true,
      supportsModelListing: !isAntigravity,
    },
  ]
}
