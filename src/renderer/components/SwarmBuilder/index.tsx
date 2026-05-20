import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentModelCatalog,
  AppSettings,
  SupportedAgentId,
  SwarmAgentConfig,
  SwarmConfig,
  SwarmResult,
} from '../../../shared/types'
import { AgentRow } from './AgentRow'
import {
  buildDefaultSwarmAgents,
  DEFAULT_SWARM_AGENT_IDS,
  DEFAULT_SWARM_MODEL_CATALOGS,
  normalizeSwarmAgents,
  resolveAvailableSwarmAgents,
} from './agentSelection'

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

export function SwarmBuilder({
  open,
  projectId,
  threadId,
  initialPrompt = '',
  installedAgents = DEFAULT_SWARM_AGENT_IDS,
  onClose,
  onSwarmStarted,
}: Props) {
  const [strategy, setStrategy] = useState<Strategy>('parallel')
  const [prompt, setPrompt] = useState(initialPrompt)
  const [agents, setAgents] = useState<SwarmAgentConfig[]>(() =>
    buildDefaultSwarmAgents(installedAgents),
  )
  const [modelCatalogs, setModelCatalogs] = useState<AgentModelCatalog[]>(
    DEFAULT_SWARM_MODEL_CATALOGS,
  )
  const [modelCatalogsLoaded, setModelCatalogsLoaded] = useState(false)
  const [swarmSettings, setSwarmSettings] = useState<AppSettings['swarms'] | null>(null)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      autoManageAgentsRef.current = true
    }
  }, [initialPrompt, open])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    window.agentforge.settings
      .getEffective(projectId ?? undefined)
      .then((effective) => {
        if (cancelled) return
        setSwarmSettings(effective.settings.swarms)
        setStrategy(effective.settings.swarms.defaultStrategy)
      })
      .catch(() => {
        if (!cancelled) setSwarmSettings(null)
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

  const costEstimate = useMemo(() => estimateCost(agents), [agents])
  const templates = swarmSettings?.templates ?? TEMPLATES
  const maxAgents = swarmSettings?.maxAgents ?? MAX_AGENTS
  const canLaunch = Boolean(
    projectId && prompt.trim() && agents.length > 0 && availableAgents.length > 0 && !launching,
  )

  if (!open) return null

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
        agents,
        maxIterations: swarmSettings?.maxReviewerIterations,
      })
      onSwarmStarted?.(result.swarmId, result)
      onClose()
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : 'Failed to launch swarm')
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="swarm-builder-title"
        className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 id="swarm-builder-title" className="text-base font-semibold text-zinc-100">
            Swarm Builder
          </h2>
          <fieldset className="flex items-center gap-1">
            {(['parallel', 'sequential', 'fan-out'] as Strategy[]).map((nextStrategy) => (
              <label
                key={nextStrategy}
                className={`cursor-pointer rounded px-3 py-1.5 text-xs ${
                  strategy === nextStrategy
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'text-zinc-400 hover:bg-zinc-900'
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

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="grid gap-4">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="h-28 resize-none rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
              placeholder="Describe the swarm task..."
              aria-label="Swarm prompt"
            />

            <div className="flex flex-wrap gap-2">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900"
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
                  {template.label}
                </button>
              ))}
            </div>

            <section className="rounded-md border border-zinc-800">
              <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Agents
                </div>
                <button
                  type="button"
                  className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
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
                </button>
              </div>
              <div className="px-3">
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
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-zinc-800 px-5 py-4">
          <div className="text-xs text-zinc-500">
            Estimate {costEstimate}
            {error ? <span className="ml-3 text-red-400">{error}</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
              onClick={onClose}
              disabled={launching}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handleLaunch()}
              disabled={!canLaunch}
            >
              {launching ? 'Launching...' : 'Launch Swarm Cmd+Shift+Enter'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

function estimateCost(agents: SwarmAgentConfig[]): string {
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
