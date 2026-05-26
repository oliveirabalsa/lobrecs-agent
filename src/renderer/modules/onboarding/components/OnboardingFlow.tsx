import { useEffect, useMemo, useState } from 'react'
import {
  AGENT_LABELS,
  SUPPORTED_AGENT_IDS,
  type ManagedCliActionId,
  type ManagedCliActionResult,
  type ManagedCliStatus,
  type Project,
  type SupportedAgentId,
  type SwarmResult,
} from '../../../../shared/types'
import { Button } from '../../../components/ui'
import {
  ONBOARDING_STEPS,
  markOnboardingComplete,
  markOnboardingSkipped,
  readOnboardingProgress,
  saveOnboardingStep,
  type OnboardingStep,
} from '../domain/onboardingState'

interface OnboardingFlowProps {
  open: boolean
  selectedProject: Project | null
  onClose: () => void
  onProjectCreated: (project: Project) => void
  onSwarmStarted: (result: SwarmResult) => void
}

const STEP_LABELS: Record<OnboardingStep, string> = {
  agents: 'Agents',
  credentials: 'Credentials',
  project: 'Project',
  swarm: 'Swarm demo',
}

const CREDENTIAL_HELP: Record<SupportedAgentId, string> = {
  'claude-code':
    'Use the Claude Code CLI login flow or Anthropic environment variables. Lobrecs only checks the CLI status.',
  codex:
    'Use Codex login or the OpenAI environment expected by your Codex CLI. Keys stay outside Lobrecs.',
  opencode:
    'Configure OpenCode with its normal provider auth or environment variables, then run the status check.',
  antigravity:
    'Configure Antigravity CLI credentials in the provider tool, then return here and run the status check.',
  cursor:
    'Use Cursor CLI login or CURSOR_API_KEY in your environment. Lobrecs only runs fixed Cursor CLI checks and does not store keys.',
}

const DEMO_PROMPT =
  'Create one tiny documentation-only improvement so I can review the diff in Lobrecs. Keep the change safe, scoped, and easy to revert.'

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function folderName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.at(-1) ?? 'First Project'
}

function preferredAgentId(statuses: readonly ManagedCliStatus[]): SupportedAgentId {
  const installed = statuses.find((status) => status.installed)?.agentId
  return installed ?? 'claude-code'
}

export function OnboardingFlow({
  open,
  selectedProject,
  onClose,
  onProjectCreated,
  onSwarmStarted,
}: OnboardingFlowProps) {
  const [step, setStep] = useState<OnboardingStep>(() =>
    readOnboardingProgress(safeLocalStorage()).step,
  )
  const [statuses, setStatuses] = useState<ManagedCliStatus[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [createdProject, setCreatedProject] = useState<Project | null>(null)
  const [repoPath, setRepoPath] = useState('')
  const [projectName, setProjectName] = useState('')
  const [demoPrompt, setDemoPrompt] = useState(DEMO_PROMPT)
  const [loading, setLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [authResults, setAuthResults] = useState<Record<string, ManagedCliActionResult>>({})

  const installedStatuses = useMemo(
    () => statuses.filter((status) => status.installed),
    [statuses],
  )
  const targetProject = createdProject ?? selectedProject ?? projects[0] ?? null
  const agentId = preferredAgentId(statuses)
  const canCreateProject = repoPath.trim().length > 0 && projectName.trim().length > 0
  const canLaunchDemo = Boolean(targetProject && installedStatuses.length > 0 && demoPrompt.trim())

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setError(null)
    setNotice(null)
    setStep(readOnboardingProgress(safeLocalStorage()).step)
    setLoading(true)

    Promise.all([
      window.agentforge.system.listManagedCliRuntimes().catch(() => []),
      window.agentforge.projects.list().catch(() => []),
    ])
      .then(([nextStatuses, nextProjects]) => {
        if (cancelled) return
        setStatuses(nextStatuses)
        setProjects(nextProjects)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!repoPath.trim()) return
    setProjectName((current) => current || folderName(repoPath))
  }, [repoPath])

  if (!open) return null

  function goToStep(nextStep: OnboardingStep) {
    saveOnboardingStep(safeLocalStorage(), nextStep)
    setStep(nextStep)
    setError(null)
    setNotice(null)
  }

  function skip() {
    markOnboardingSkipped(safeLocalStorage())
    onClose()
  }

  function complete() {
    markOnboardingComplete(safeLocalStorage())
    onClose()
  }

  async function refreshAgents() {
    setLoading(true)
    setError(null)
    try {
      setStatuses(await window.agentforge.system.listManagedCliRuntimes())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to detect installed agents')
    } finally {
      setLoading(false)
    }
  }

  async function enableDetectedAgents() {
    const detectedIds = installedStatuses.map((status) => status.agentId)
    if (detectedIds.length === 0) {
      setError('Install at least one supported CLI before enabling detected agents.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const settings = await window.agentforge.settings.getGlobal()
      const enabledAgentIds = [...new Set(detectedIds)]
      await window.agentforge.settings.updateGlobal({
        agents: {
          ...settings.agents,
          defaultAgentId: enabledAgentIds[0],
          fallbackAgentId: enabledAgentIds[0],
          enabledAgentIds,
          runtimes: {
            ...settings.agents.runtimes,
            ...Object.fromEntries(
              enabledAgentIds.map((id) => [
                id,
                { ...settings.agents.runtimes[id], enabled: true },
              ]),
            ),
          },
        },
      })
      setNotice(`Enabled ${enabledAgentIds.map((id) => AGENT_LABELS[id]).join(', ')}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to enable detected agents')
    } finally {
      setLoading(false)
    }
  }

  async function runAgentAction(agentId: SupportedAgentId, actionId: ManagedCliActionId) {
    const key = `${agentId}:${actionId}`
    setActionBusy(key)
    setError(null)
    try {
      const result = await window.agentforge.system.runManagedCliAction({
        agentId,
        actionId,
        repoPath: targetProject?.repoPath,
      })
      setAuthResults((current) => ({ ...current, [key]: result }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to run CLI action')
    } finally {
      setActionBusy(null)
    }
  }

  async function chooseRepoPath() {
    setError(null)
    const selected = await window.agentforge.system.selectDirectory().catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'Failed to choose a repository')
      return null
    })
    if (selected) setRepoPath(selected)
  }

  async function createProject() {
    if (!canCreateProject) return
    setLoading(true)
    setError(null)
    try {
      const project = await window.agentforge.projects.create({
        name: projectName.trim(),
        repoPath: repoPath.trim(),
        agentId,
        modelTier: 'balanced',
        context: null,
      })
      setCreatedProject(project)
      setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)])
      onProjectCreated(project)
      setNotice(`Created ${project.name}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  async function launchDemoSwarm() {
    if (!targetProject) {
      setError('Create or select a project before launching the demo.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const result = await window.agentforge.swarm.spawn({
        projectId: targetProject.id,
        prompt: demoPrompt.trim(),
        strategy: 'parallel',
        agents: [
          {
            role: 'walkthrough',
            agentId,
            promptSuffix:
              'Run as a single onboarding demo agent. Prefer a tiny documentation-only edit so the diff review surface has a clear example.',
          },
        ],
      })
      onSwarmStarted(result)
      markOnboardingComplete(safeLocalStorage())
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to launch demo swarm')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 px-3 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-card border border-hairline bg-canvas shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-hairline bg-sidebar px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-card border border-accent-primary/30 bg-accent-primary/15 text-[12px] font-semibold text-accent-primary">
            LA
          </div>
          <div className="min-w-0">
            <h2 id="onboarding-title" className="text-[14px] font-semibold text-primary">
              Set up Lobrecs Agent
            </h2>
            <p className="text-[12px] text-muted">
              Detect CLIs, verify credentials, add a repository, then run a one-agent swarm.
            </p>
          </div>
          <button
            type="button"
            onClick={skip}
            className="ml-auto rounded-card px-3 py-1.5 text-[12px] text-muted hover:bg-white/5 hover:text-primary"
          >
            Skip
          </button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="border-b border-hairline bg-sidebar px-3 py-3 md:border-b-0 md:border-r">
            <nav className="grid gap-1">
              {ONBOARDING_STEPS.map((item, index) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => goToStep(item)}
                  className={`flex items-center gap-2 rounded-card px-2 py-2 text-left text-[12px] ${
                    step === item
                      ? 'bg-card-raised text-primary'
                      : 'text-secondary hover:bg-white/5 hover:text-primary'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                      step === item
                        ? 'border-accent-primary/40 bg-accent-primary/15 text-accent-primary'
                        : 'border-hairline text-muted'
                    }`}
                  >
                    {index + 1}
                  </span>
                  {STEP_LABELS[item]}
                </button>
              ))}
            </nav>
          </aside>

          <div className="min-h-0 overflow-y-auto px-5 py-5">
            {error ? (
              <div className="mb-4 rounded-card border border-accent-del/30 bg-accent-del/10 px-3 py-2 text-[12px] text-accent-del">
                {error}
              </div>
            ) : null}
            {notice ? (
              <div className="mb-4 rounded-card border border-accent-add/30 bg-accent-add/10 px-3 py-2 text-[12px] text-accent-add">
                {notice}
              </div>
            ) : null}

            {step === 'agents' ? (
              <AgentsStep
                statuses={statuses}
                loading={loading}
                onRefresh={() => void refreshAgents()}
                onEnable={() => void enableDetectedAgents()}
              />
            ) : step === 'credentials' ? (
              <CredentialsStep
                statuses={statuses}
                results={authResults}
                busyKey={actionBusy}
                onRunAction={(nextAgentId, actionId) => void runAgentAction(nextAgentId, actionId)}
              />
            ) : step === 'project' ? (
              <ProjectStep
                targetProject={targetProject}
                repoPath={repoPath}
                projectName={projectName}
                loading={loading}
                onRepoPathChange={setRepoPath}
                onProjectNameChange={setProjectName}
                onChooseRepoPath={() => void chooseRepoPath()}
                onCreateProject={() => void createProject()}
                canCreateProject={canCreateProject}
              />
            ) : (
              <SwarmDemoStep
                targetProject={targetProject}
                agentId={agentId}
                installedCount={installedStatuses.length}
                prompt={demoPrompt}
                loading={loading}
                canLaunch={canLaunchDemo}
                onPromptChange={setDemoPrompt}
                onLaunch={() => void launchDemoSwarm()}
                onFinish={complete}
              />
            )}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-hairline bg-sidebar px-4 py-3">
          <div className="text-[12px] text-muted">
            {targetProject ? `Project: ${targetProject.name}` : 'No project selected yet'}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={step === 'agents'}
              onClick={() => goToStep(previousStep(step))}
            >
              Back
            </Button>
            {step === 'swarm' ? (
              <Button variant="primary" size="sm" onClick={complete}>
                Finish
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => goToStep(nextStep(step))}>
                Continue
              </Button>
            )}
          </div>
        </footer>
      </section>
    </div>
  )
}

function AgentsStep({
  statuses,
  loading,
  onRefresh,
  onEnable,
}: {
  statuses: ManagedCliStatus[]
  loading: boolean
  onRefresh: () => void
  onEnable: () => void
}) {
  const installedCount = statuses.filter((status) => status.installed).length

  return (
    <section className="grid gap-4">
      <StepHeader
        title="Detect installed coding agents"
        detail="Lobrecs checks supported CLIs on your PATH and can enable the detected runners in app settings."
      />
      <div className="grid gap-2 sm:grid-cols-2">
        {SUPPORTED_AGENT_IDS.map((agentId) => {
          const status = statuses.find((item) => item.agentId === agentId)
          return <AgentStatusCard key={agentId} agentId={agentId} status={status} />
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="chip" size="sm" onClick={onRefresh} loading={loading}>
          Redetect agents
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onEnable}
          disabled={installedCount === 0}
          loading={loading}
        >
          Enable detected
        </Button>
      </div>
    </section>
  )
}

function CredentialsStep({
  statuses,
  results,
  busyKey,
  onRunAction,
}: {
  statuses: ManagedCliStatus[]
  results: Record<string, ManagedCliActionResult>
  busyKey: string | null
  onRunAction: (agentId: SupportedAgentId, actionId: ManagedCliActionId) => void
}) {
  return (
    <section className="grid gap-4">
      <StepHeader
        title="Verify provider credentials"
        detail="Provider keys and sessions stay in each CLI or environment. This screen only runs status checks and links to the provider docs."
      />
      <div className="grid gap-3">
        {statuses.map((status) => {
          const authAction = status.actions.find((action) => action.id === 'auth-status')
          const resultKey = `${status.agentId}:auth-status`
          const result = results[resultKey]

          return (
            <div
              key={status.agentId}
              className="rounded-card border border-hairline bg-card px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-primary">{status.name}</div>
                  <p className="mt-1 text-[12px] leading-5 text-muted">
                    {CREDENTIAL_HELP[status.agentId]}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <a
                    href={status.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-card border border-hairline bg-card-raised px-2.5 py-1.5 text-[12px] text-secondary hover:text-primary"
                  >
                    Docs
                  </a>
                  <Button
                    variant="chip"
                    size="sm"
                    disabled={!authAction?.available}
                    loading={busyKey === resultKey}
                    onClick={() => onRunAction(status.agentId, 'auth-status')}
                  >
                    Check auth
                  </Button>
                </div>
              </div>
              {authAction ? (
                <p className="mt-2 font-mono text-[11px] text-muted">
                  {authAction.commandPreview}
                </p>
              ) : null}
              {result ? (
                <pre className="mt-3 max-h-28 overflow-auto rounded-card border border-hairline bg-canvas p-2 text-[11px] leading-5 text-secondary">
                  {summarizeActionResult(result)}
                </pre>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ProjectStep({
  targetProject,
  repoPath,
  projectName,
  loading,
  canCreateProject,
  onRepoPathChange,
  onProjectNameChange,
  onChooseRepoPath,
  onCreateProject,
}: {
  targetProject: Project | null
  repoPath: string
  projectName: string
  loading: boolean
  canCreateProject: boolean
  onRepoPathChange: (value: string) => void
  onProjectNameChange: (value: string) => void
  onChooseRepoPath: () => void
  onCreateProject: () => void
}) {
  return (
    <section className="grid gap-4">
      <StepHeader
        title="Create your first project"
        detail="Point Lobrecs at a local repository. Agents run locally against that path and completed diffs appear in the workspace."
      />
      {targetProject ? (
        <div className="rounded-card border border-accent-add/30 bg-accent-add/10 px-4 py-3">
          <div className="text-[13px] font-semibold text-accent-add">{targetProject.name}</div>
          <div className="mt-1 truncate font-mono text-[11px] text-secondary">
            {targetProject.repoPath}
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 rounded-card border border-hairline bg-card px-4 py-4">
        <label className="grid gap-1.5">
          <span className="text-[12px] font-medium text-secondary">Repository path</span>
          <div className="flex gap-2">
            <input
              value={repoPath}
              onChange={(event) => onRepoPathChange(event.target.value)}
              placeholder="Choose an existing local repository"
              className="h-9 min-w-0 flex-1 rounded-card border border-hairline bg-canvas px-2.5 font-mono text-[12px] text-primary outline-none placeholder:text-muted focus:border-hairline-strong"
            />
            <Button variant="chip" size="sm" onClick={onChooseRepoPath}>
              Browse
            </Button>
          </div>
        </label>
        <label className="grid gap-1.5">
          <span className="text-[12px] font-medium text-secondary">Project name</span>
          <input
            value={projectName}
            onChange={(event) => onProjectNameChange(event.target.value)}
            placeholder="First Project"
            className="h-9 rounded-card border border-hairline bg-canvas px-2.5 text-[13px] text-primary outline-none placeholder:text-muted focus:border-hairline-strong"
          />
        </label>
        <div>
          <Button
            variant="primary"
            size="sm"
            onClick={onCreateProject}
            disabled={!canCreateProject}
            loading={loading}
          >
            Create project
          </Button>
        </div>
      </div>
    </section>
  )
}

function SwarmDemoStep({
  targetProject,
  agentId,
  installedCount,
  prompt,
  loading,
  canLaunch,
  onPromptChange,
  onLaunch,
  onFinish,
}: {
  targetProject: Project | null
  agentId: SupportedAgentId
  installedCount: number
  prompt: string
  loading: boolean
  canLaunch: boolean
  onPromptChange: (value: string) => void
  onLaunch: () => void
  onFinish: () => void
}) {
  return (
    <section className="grid gap-4">
      <StepHeader
        title="Run a one-agent swarm demo"
        detail="The demo starts one agent on the selected repository and opens the workspace so you can watch output and inspect the resulting diff."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid gap-3 rounded-card border border-hairline bg-card px-4 py-4">
          <div className="flex flex-wrap gap-2 text-[12px] text-muted">
            <span className="rounded-pill border border-hairline bg-card-raised px-2 py-1">
              {targetProject?.name ?? 'No project'}
            </span>
            <span className="rounded-pill border border-hairline bg-card-raised px-2 py-1">
              {AGENT_LABELS[agentId]}
            </span>
          </div>
          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-secondary">Demo task</span>
            <textarea
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              className="h-28 resize-none rounded-card border border-hairline bg-canvas px-3 py-2 text-[13px] leading-5 text-primary outline-none placeholder:text-muted focus:border-hairline-strong"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={onLaunch}
              disabled={!canLaunch}
              loading={loading}
            >
              Launch demo agent
            </Button>
            <Button variant="ghost" size="sm" onClick={onFinish}>
              Finish without demo
            </Button>
          </div>
          {installedCount === 0 ? (
            <p className="text-[12px] text-accent-warn">
              Install or enable one supported CLI before launching the demo.
            </p>
          ) : null}
        </div>
        <div className="rounded-card border border-hairline bg-card px-4 py-4">
          <div className="mb-3 text-[12px] font-semibold text-secondary">Diff preview</div>
          <div className="rounded-card border border-hairline bg-canvas p-3 font-mono text-[11px] leading-5">
            <div className="text-accent-add">+ docs/onboarding-note.md</div>
            <div className="mt-2 text-secondary">@@ -0,0 +1,3 @@</div>
            <div className="text-accent-add">+ A small generated change appears here.</div>
            <div className="text-accent-add">+ Review it in the right panel.</div>
          </div>
        </div>
      </div>
    </section>
  )
}

function AgentStatusCard({
  agentId,
  status,
}: {
  agentId: SupportedAgentId
  status?: ManagedCliStatus
}) {
  const installed = status?.installed === true

  return (
    <div className="rounded-card border border-hairline bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-primary">{AGENT_LABELS[agentId]}</div>
        <span
          className={`rounded-pill border px-2 py-0.5 text-[11px] ${
            installed
              ? 'border-accent-add/30 bg-accent-add/10 text-accent-add'
              : 'border-accent-warn/30 bg-accent-warn/10 text-accent-warn'
          }`}
        >
          {installed ? 'Detected' : 'Missing'}
        </span>
      </div>
      <div className="mt-2 truncate font-mono text-[11px] text-muted">
        {status?.commandPath ?? status?.command ?? 'Waiting for detection'}
      </div>
      {status?.version ? (
        <div className="mt-1 text-[11px] text-secondary">{status.version}</div>
      ) : null}
    </div>
  )
}

function StepHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div>
      <h3 className="text-[18px] font-semibold text-primary">{title}</h3>
      <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted">{detail}</p>
    </div>
  )
}

function nextStep(step: OnboardingStep): OnboardingStep {
  const index = ONBOARDING_STEPS.indexOf(step)
  return ONBOARDING_STEPS[Math.min(index + 1, ONBOARDING_STEPS.length - 1)]
}

function previousStep(step: OnboardingStep): OnboardingStep {
  const index = ONBOARDING_STEPS.indexOf(step)
  return ONBOARDING_STEPS[Math.max(index - 1, 0)]
}

function summarizeActionResult(result: ManagedCliActionResult): string {
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')
  const summary = output || `Exited with ${result.exitCode ?? result.signal ?? 'unknown status'}`
  return summary.length > 1200 ? `${summary.slice(-1200)}` : summary
}
