import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import type {
  AgentModelCatalog,
  AgentProfile,
  AppSettings,
  ImageAttachment,
  SupportedAgentId,
  SwarmAgentConfig,
  SwarmConfig,
  SwarmResult,
} from '../../../shared/types'
import { Button } from '../ui'
import { AgentRow } from './AgentRow'
import {
  buildDefaultSwarmAgents,
  DEFAULT_SWARM_AGENT_IDS,
  DEFAULT_SWARM_MODEL_CATALOGS,
  normalizeSwarmAgents,
  resolveAvailableSwarmAgents,
} from './agentSelection'

interface AttachedImage {
  id: string
  /** Object URL for image previews; absent for non-image files. */
  previewUrl?: string
  attachment: ImageAttachment
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Failed to read image'))
    }
    reader.onerror = () => reject(new Error('Failed to read image'))
    reader.readAsDataURL(file)
  })
}

interface Props {
  open: boolean
  projectId: string | null
  threadId?: string | null
  initialPrompt?: string
  installedAgents?: SupportedAgentId[]
  onClose: () => void
  onSwarmStarted?: (swarmId: string, result: SwarmResult) => void
}

type Strategy = SwarmConfig['strategy']

const MAX_AGENTS = 8

const ROLE_DEFAULT_PROMPTS: Record<string, string> = {
  planner:
    'Analyze the task deeply and produce a concrete implementation plan: which files to create or modify, what logic to add, and why. Your output feeds directly into the implementer.',
  implementer:
    'Follow the plan precisely. Write complete, production-ready code. Do not leave placeholders or skip steps.',
  reviewer:
    'Review the implementation for correctness, bugs, edge cases, and code quality. Be specific and actionable in your feedback.',
}

function defaultPromptForRole(
  role: string,
  rolePrompts: Record<string, string> = ROLE_DEFAULT_PROMPTS,
): string | undefined {
  const normalizedRole = role.trim().toLowerCase()
  return rolePrompts[normalizedRole] ?? ROLE_DEFAULT_PROMPTS[normalizedRole]
}

const TEMPLATES: Array<{
  id: string
  label: string
  strategy: Strategy
  agents: SwarmAgentConfig[]
}> = [
  {
    id: 'managed-autopilot',
    label: 'Managed',
    strategy: 'managed',
    agents: [],
  },
  {
    id: 'security-quality',
    label: 'Security + Quality Review',
    strategy: 'parallel',
    agents: [
      {
        role: 'security analyzer',
        agentId: 'claude-code',
        promptSuffix: 'Focus on security vulnerabilities, secret handling, and unsafe IO.',
      },
      {
        role: 'code quality',
        agentId: 'codex',
        promptSuffix: 'Focus on correctness, maintainability, and missing tests.',
      },
    ],
  },
  {
    id: 'plan-implement-review',
    label: 'Plan → Implement → Review',
    strategy: 'sequential',
    agents: [
      {
        role: 'planner',
        agentId: 'claude-code',
        promptSuffix: ROLE_DEFAULT_PROMPTS.planner,
      },
      {
        role: 'implementer',
        agentId: 'codex',
        promptSuffix: ROLE_DEFAULT_PROMPTS.implementer,
      },
      {
        role: 'reviewer',
        agentId: 'claude-code',
        promptSuffix: ROLE_DEFAULT_PROMPTS.reviewer,
      },
    ],
  },
  {
    id: 'multi-approach',
    label: 'Multi-approach',
    strategy: 'parallel',
    agents: [
      { role: 'approach a', agentId: 'claude-code' },
      { role: 'approach b', agentId: 'codex' },
      { role: 'approach c', agentId: 'opencode' },
      { role: 'approach d', agentId: 'antigravity' },
    ],
  },
]

const STRATEGY_OPTIONS: Strategy[] = ['managed', 'parallel', 'sequential', 'fan-out']

export function SwarmBuilder({
  open,
  projectId,
  threadId,
  initialPrompt = '',
  installedAgents = DEFAULT_SWARM_AGENT_IDS,
  onClose,
  onSwarmStarted,
}: Props) {
  const [strategy, setStrategy] = useState<Strategy>('managed')
  const [prompt, setPrompt] = useState(initialPrompt)
  const [agents, setAgents] = useState<SwarmAgentConfig[]>(() =>
    buildDefaultSwarmAgents(installedAgents),
  )
  const [modelCatalogs, setModelCatalogs] = useState<AgentModelCatalog[]>(
    DEFAULT_SWARM_MODEL_CATALOGS,
  )
  const [modelCatalogsLoaded, setModelCatalogsLoaded] = useState(false)
  const [swarmSettings, setSwarmSettings] = useState<AppSettings['swarms'] | null>(null)
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [profileIssues, setProfileIssues] = useState(0)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<AttachedImage[]>([])
  const [attaching, setAttaching] = useState(false)
  const autoManageAgentsRef = useRef(true)
  const availableAgents = useMemo(
    () =>
      resolveAvailableSwarmAgents({
        modelCatalogs,
        fallbackAgents: installedAgents,
        catalogsLoaded: modelCatalogsLoaded,
      }),
    [installedAgents, modelCatalogs, modelCatalogsLoaded],
  )

  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt)
      setError(null)
      setAttachments([])
      autoManageAgentsRef.current = true
    }
  }, [initialPrompt, open])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    Promise.all([
      window.agentforge.settings.getEffective(projectId ?? undefined),
      projectId
        ? window.agentforge.agent.listProfiles(projectId)
        : Promise.resolve({ profiles: [], issues: [] }),
    ])
      .then(([effective, profileResult]) => {
        if (cancelled) return
        setSwarmSettings(effective.settings.swarms)
        setStrategy(effective.settings.swarms.defaultStrategy)
        setProfiles(profileResult.profiles)
        setProfileIssues(profileResult.issues.length)
      })
      .catch(() => {
        if (!cancelled) {
          setSwarmSettings(null)
          setProfiles([])
          setProfileIssues(0)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, projectId])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setModelCatalogsLoaded(false)

    window.agentforge.system
      .listAgentModels()
      .then((catalogs) => {
        if (!cancelled) {
          setModelCatalogs(catalogs)
          setModelCatalogsLoaded(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModelCatalogs(DEFAULT_SWARM_MODEL_CATALOGS)
          setModelCatalogsLoaded(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open || availableAgents.length === 0) return

    setAgents((current) =>
      autoManageAgentsRef.current
        ? buildSettingsDefaultSwarmAgents(swarmSettings?.defaultAgents, availableAgents)
        : normalizeSwarmAgents(current, availableAgents),
    )
  }, [availableAgents, open, swarmSettings?.defaultAgents])

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return
      if (event.key.toLowerCase() === 'enter') {
        event.preventDefault()
        void handleLaunch()
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const isManaged = strategy === 'managed'
  const costEstimate = useMemo(() => estimateCost(agents, strategy), [agents, strategy])
  const templates = swarmSettings?.templates ?? TEMPLATES
  const maxAgents = swarmSettings?.maxAgents ?? MAX_AGENTS
  const canLaunch = Boolean(
    projectId &&
      prompt.trim() &&
      (isManaged || agents.length > 0) &&
      availableAgents.length > 0 &&
      !launching,
  )

  if (!open) return null

  async function attachFiles(files: File[]) {
    if (files.length === 0) return
    const remaining = 8 - attachments.length
    if (remaining <= 0) return
    const accepted = files.slice(0, remaining)

    setAttaching(true)
    setError(null)
    try {
      const saved: AttachedImage[] = await Promise.all(
        accepted.map(async (file) => {
          const dataUrl = await readFileAsDataUrl(file)
          const attachment = await window.agentforge.system.saveAttachment({
            dataUrl,
            name: file.name || `clipboard-${Date.now()}`,
            mimeType: file.type,
          })
          return {
            id: `${attachment.filePath}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
            attachment,
          }
        }),
      )
      setAttachments((current) => [...current, ...saved])
    } catch (attachError) {
      setError(attachError instanceof Error ? attachError.message : 'Failed to attach file')
    } finally {
      setAttaching(false)
    }
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))

    if (files.length === 0) return
    event.preventDefault()
    await attachFiles(files)
  }

  async function handleLaunch() {
    if (!canLaunch || !projectId) return

    setLaunching(true)
    setError(null)

    try {
      const result = await window.agentforge.swarm.spawn({
        projectId,
        threadId: threadId ?? undefined,
        prompt: prompt.trim(),
        strategy,
        agents: isManaged ? [] : agents,
        maxIterations: swarmSettings?.maxReviewerIterations,
        imageAttachments: attachments.length > 0 ? attachments.map((a) => a.attachment) : undefined,
      })
      onSwarmStarted?.(result.swarmId, result)
      onClose()
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : 'Failed to launch swarm')
    } finally {
      setLaunching(false)
    }
  }

  function addProfileAgent(profile: AgentProfile) {
    if (availableAgents.length === 0) return
    const agentId =
      profile.defaultAgentId && availableAgents.includes(profile.defaultAgentId)
        ? profile.defaultAgentId
        : availableAgents[0]

    autoManageAgentsRef.current = false
    if (strategy === 'managed') setStrategy('parallel')
    setAgents((current) => [
      ...current.slice(0, Math.max(0, maxAgents - 1)),
      {
        profileId: profile.id,
        role: profile.role,
        agentId,
        modelOverride: profile.defaultAgentId === agentId ? profile.defaultModel : undefined,
        promptSuffix: profile.instructions,
      },
    ])
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="swarm-builder-title"
        className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-card border border-hairline bg-card shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-accent-primary/30 bg-accent-primary/15 text-accent-primary">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="5" r="2" />
              <circle cx="19" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
              <path d="M7 12h4m1-5v4m1 3h4m-5 1v4" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 id="swarm-builder-title" className="text-[13px] font-semibold text-primary">
              Swarm Builder
            </h2>
            <p className="text-[11px] text-muted">Configure and launch a multi-agent task</p>
          </div>
          <fieldset className="ml-auto flex items-center gap-0.5 rounded-pill border border-hairline bg-card-raised p-0.5">
            <legend className="sr-only">Strategy</legend>
            {STRATEGY_OPTIONS.map((nextStrategy) => (
              <label
                key={nextStrategy}
                className={`cursor-pointer rounded-pill px-3 py-1 text-[11px] font-medium capitalize transition-colors ${
                  strategy === nextStrategy
                    ? 'bg-accent-primary/90 text-white shadow-sm shadow-accent-primary/20'
                    : 'text-secondary hover:bg-white/5 hover:text-primary'
                }`}
              >
                <input
                  type="radio"
                  name="swarm-strategy"
                  value={nextStrategy}
                  checked={strategy === nextStrategy}
                  onChange={() => setStrategy(nextStrategy)}
                  className="sr-only"
                />
                {nextStrategy}
              </label>
            ))}
          </fieldset>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <label
                htmlFor="swarm-prompt"
                className="text-[11px] font-medium text-secondary"
              >
                Task
              </label>
              <div className="overflow-hidden rounded-card border border-hairline bg-card-raised transition focus-within:border-accent-primary/40 focus-within:ring-2 focus-within:ring-accent-primary/20">
                {attachments.length > 0 || attaching ? (
                  <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 pb-2 pt-2.5">
                    {attachments.map((image) => (
                      <div
                        key={image.id}
                        className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-card border border-hairline"
                        title={image.attachment.name}
                      >
                        {image.previewUrl ? (
                          <img
                            src={image.previewUrl}
                            alt={image.attachment.name ?? 'Attached image'}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center px-1 text-center text-[8px] uppercase leading-none text-muted">
                            {(image.attachment.name?.split('.').pop() ?? 'file').slice(0, 4)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setAttachments((current) =>
                              current.filter((a) => a.id !== image.id),
                            )
                          }
                          className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded-full bg-black/80 text-[10px] text-white group-hover:flex"
                          aria-label={`Remove ${image.attachment.name ?? 'image'}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {attaching ? (
                      <span className="text-xs text-muted">Attaching…</span>
                    ) : null}
                  </div>
                ) : null}
                <textarea
                  id="swarm-prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onPaste={(event) => void handlePaste(event)}
                  className="h-28 w-full resize-none bg-transparent px-3 py-2.5 text-sm text-primary outline-none placeholder:text-muted"
                  placeholder="Describe what the swarm should do…"
                  aria-label="Swarm prompt"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted">
                Quick start
              </div>
              <div className="flex flex-wrap gap-1.5">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-card-raised px-2.5 py-1 text-[11px] text-secondary transition-colors hover:border-accent-primary/30 hover:bg-accent-primary/10 hover:text-primary"
                    onClick={() => {
                      autoManageAgentsRef.current = false
                      setStrategy(template.strategy)
                      setAgents(
                        normalizeSwarmAgents(template.agents, availableAgents, {
                          spreadDuplicates: true,
                        }),
                      )
                    }}
                  >
                    <span aria-hidden="true" className="text-muted">
                      {strategyGlyph(template.strategy)}
                    </span>
                    {template.label}
                  </button>
                ))}
              </div>
            </div>

            {profiles.length > 0 ? (
              <div className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted">
                    Profiles
                  </div>
                  {profileIssues > 0 ? (
                    <span className="text-[10px] text-accent-warn">
                      {profileIssues} issue{profileIssues === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {profiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-card-raised px-2.5 py-1 text-[11px] text-secondary transition-colors hover:border-accent-primary/30 hover:bg-accent-primary/10 hover:text-primary"
                      onClick={() => addProfileAgent(profile)}
                    >
                      <span aria-hidden="true" className="text-muted">◇</span>
                      {profile.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {!isManaged ? (
              <section className="rounded-card border border-hairline">
                <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted">
                    Agents
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={agents.length >= maxAgents || availableAgents.length === 0}
                    onClick={() =>
                      setAgents((current) => {
                        autoManageAgentsRef.current = false

                        return [
                          ...current,
                          {
                            role: `agent ${current.length + 1}`,
                            agentId:
                              availableAgents[current.length % availableAgents.length] ??
                              'claude-code',
                          },
                        ]
                      })
                    }
                  >
                    + Add agent
                  </Button>
                </div>
                <div className="divide-y divide-hairline px-3">
                  {agents.map((agent, index) => (
                    <AgentRow
                      key={index}
                      index={index}
                      config={agent}
                      installedAgents={availableAgents}
                      modelCatalogs={modelCatalogs}
                      sequential={strategy === 'sequential'}
                      removable={agents.length > 1}
                      onChange={(nextAgent) =>
                        setAgents((current) => {
                          autoManageAgentsRef.current = false
                          const prev = current[index]
                          const roleChanged = nextAgent.role !== prev?.role
                          const resolved =
                            roleChanged && !nextAgent.promptSuffix
                              ? {
                                  ...nextAgent,
                                  promptSuffix: defaultPromptForRole(
                                    nextAgent.role,
                                    swarmSettings?.rolePrompts,
                                  ),
                                }
                              : nextAgent
                          return current.map((item, itemIndex) =>
                            itemIndex === index ? resolved : item,
                          )
                        })
                      }
                      onRemove={() =>
                        setAgents((current) => {
                          autoManageAgentsRef.current = false

                          return current.filter((_, itemIndex) => itemIndex !== index)
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-hairline px-4 py-3">
          <div className="min-w-0 text-[11px] text-muted">
            Estimate {costEstimate}
            {error ? (
              <span className="ml-3 text-accent-del">{error}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={launching}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleLaunch()}
              disabled={!canLaunch}
              loading={launching}
            >
              {launching ? (
                'Launching…'
              ) : (
                <span className="flex items-center gap-1.5">
                  Launch Swarm
                  <kbd className="font-sans text-[10px] opacity-60">⌘⇧↵</kbd>
                </span>
              )}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  )
}

function strategyGlyph(strategy: Strategy): string {
  if (strategy === 'managed') return '◆'
  if (strategy === 'parallel') return '⟨⟩'
  if (strategy === 'sequential') return '→'
  return '⤴'
}

function estimateCost(agents: SwarmAgentConfig[], strategy: Strategy): string {
  if (strategy === 'managed') return '~$0.03+'

  const estimatedUnits = agents.reduce((total, agent) => {
    const model = agent.modelOverride?.toLowerCase() ?? ''
    if (model.includes('opus') || model.includes('frontier')) return total + 5
    if (model.includes('sonnet') || model.includes('gpt-5')) return total + 3
    return total + 1
  }, 0)

  const low = Math.max(0.01, estimatedUnits * 0.005)
  const high = Math.max(low + 0.01, estimatedUnits * 0.02)

  return `~$${low.toFixed(2)} - $${high.toFixed(2)}`
}

function buildSettingsDefaultSwarmAgents(
  configuredAgents: readonly SwarmAgentConfig[] | undefined,
  availableAgents: readonly SupportedAgentId[],
): SwarmAgentConfig[] {
  if (!configuredAgents?.length) {
    return buildDefaultSwarmAgents(availableAgents)
  }

  return normalizeSwarmAgents(configuredAgents, availableAgents, {
    spreadDuplicates: true,
  })
}
