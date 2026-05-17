import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type {
  AgentModelCatalog,
  ModelTier,
  RoutingDecision,
  SupportedAgentId,
} from '../../../shared/types'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

export interface StartedSessionSummary {
  sessionId: string
  prompt: string
  routingDecision: RoutingDecision | null
  agentId?: SupportedAgentId
  modelOverride?: string
}

interface Props {
  projectId: string
  busy?: boolean
  busyReason?: string
  prefillPrompt?: string
  onSessionStarted: (session: StartedSessionSummary) => void
}

interface ModelOption {
  key: string
  value: string
  label: string
  agentId: SupportedAgentId
  agentName: string
  tier: ModelTier
}

const FALLBACK_MODEL_CATALOGS: AgentModelCatalog[] = [
  {
    agentId: 'claude-code',
    name: 'Claude Code',
    installed: true,
    models: [
      {
        id: 'claude-haiku-4-5-20251001',
        label: 'claude-haiku-4-5',
        agentId: 'claude-code',
        tier: 'lightweight',
        source: 'fallback',
      },
      {
        id: 'claude-sonnet-4-6',
        label: 'claude-sonnet-4-6',
        agentId: 'claude-code',
        tier: 'balanced',
        source: 'fallback',
      },
      {
        id: 'claude-opus-4-6',
        label: 'claude-opus-4-6',
        agentId: 'claude-code',
        tier: 'frontier',
        source: 'fallback',
      },
    ],
  },
  {
    agentId: 'codex',
    name: 'OpenAI Codex',
    installed: true,
    models: [
      {
        id: 'gpt-5.2-codex',
        label: 'gpt-5.2-codex',
        agentId: 'codex',
        tier: 'balanced',
        source: 'fallback',
      },
      {
        id: 'gpt-5.5',
        label: 'GPT-5.5',
        agentId: 'codex',
        tier: 'frontier',
        source: 'fallback',
      },
    ],
  },
  {
    agentId: 'opencode',
    name: 'OpenCode',
    installed: true,
    models: [
      {
        id: 'opencode/minimax-m2.5-free',
        label: 'opencode/minimax-m2.5-free',
        agentId: 'opencode',
        tier: 'lightweight',
        source: 'fallback',
      },
    ],
  },
]

const TIER_STYLES: Record<ModelTier, string> = {
  lightweight: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  balanced: 'border-blue-500/40 bg-blue-500/10 text-blue-200',
  advanced: 'border-violet-500/40 bg-violet-500/10 text-violet-200',
  frontier: 'border-amber-500/50 bg-amber-500/10 text-amber-200',
}

function autosizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return
  textarea.style.height = '0px'
  textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 88), 220)}px`
}

function getManualOption(modelOverride: string | undefined) {
  return catalogOptions(FALLBACK_MODEL_CATALOGS).find((option) => option.key === modelOverride)
}

export function TaskInput({
  projectId,
  busy = false,
  busyReason,
  prefillPrompt,
  onSessionStarted,
}: Props) {
  const [prompt, setPrompt] = useState('')
  const [modelOverride, setModelOverride] = useState<string>('')
  const [modelCatalogs, setModelCatalogs] = useState<AgentModelCatalog[]>(
    FALLBACK_MODEL_CATALOGS,
  )
  const [routingDecision, setRoutingDecision] = useState<RoutingDecision | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const debouncedPrompt = useDebouncedValue(prompt, 500)

  const manualOption = useMemo(
    () =>
      catalogOptions(modelCatalogs).find((option) => option.key === modelOverride) ??
      getManualOption(modelOverride || undefined),
    [modelCatalogs, modelOverride],
  )
  const groupedModelOptions = useMemo(() => groupModelOptions(modelCatalogs), [modelCatalogs])

  useEffect(() => {
    let cancelled = false

    window.agentforge.system
      .listAgentModels()
      .then((catalogs) => {
        if (!cancelled && catalogs.some((catalog) => catalog.models.length > 0)) {
          setModelCatalogs(catalogs)
        }
      })
      .catch(() => {
        if (!cancelled) setModelCatalogs(FALLBACK_MODEL_CATALOGS)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (prefillPrompt === undefined) return
    setPrompt(prefillPrompt)
    window.requestAnimationFrame(() => autosizeTextarea(textareaRef.current))
  }, [prefillPrompt])

  useEffect(() => {
    autosizeTextarea(textareaRef.current)
  }, [prompt])

  useEffect(() => {
    if (!debouncedPrompt.trim() || modelOverride) {
      setRoutingDecision(null)
      return
    }

    let cancelled = false

    window.agentforge.router
      .preview(debouncedPrompt, projectId)
      .then((decision) => {
        if (!cancelled) setRoutingDecision(decision)
      })
      .catch(() => {
        if (!cancelled) setRoutingDecision(null)
      })

    return () => {
      cancelled = true
    }
  }, [debouncedPrompt, modelOverride, projectId])

  async function submit() {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || submitting || busy) return

    setSubmitting(true)
    setError(null)

    try {
      const result = await window.agentforge.agent.dispatch({
        projectId,
        prompt: trimmedPrompt,
        agentId: manualOption?.agentId,
        modelOverride: manualOption?.value,
      })
      onSessionStarted({
        sessionId: result.sessionId,
        prompt: trimmedPrompt,
        routingDecision,
        agentId: manualOption?.agentId,
        modelOverride: manualOption?.value,
      })
      setPrompt('')
      window.requestAnimationFrame(() => autosizeTextarea(textareaRef.current))
    } catch (dispatchError: unknown) {
      setError(dispatchError instanceof Error ? dispatchError.message : 'Failed to start session')
    } finally {
      setSubmitting(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void submit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void submit()
    }
  }

  const buttonLabel = submitting
    ? 'Starting...'
    : busyReason?.toLowerCase().includes('approval') ||
        busyReason?.toLowerCase().includes('diff')
      ? 'Awaiting review'
      : busy
        ? 'Running'
        : 'Run'
  const effectiveTier = manualOption?.tier ?? routingDecision?.tier ?? 'balanced'
  const effectiveModel = manualOption?.label ?? routingDecision?.model ?? 'Auto'
  const modelBadgeText = manualOption
    ? `Manual: ${manualOption.agentName} - ${manualOption.label}`
    : routingDecision
      ? `${routingDecision.tier} - ${routingDecision.model}`
      : 'Auto model routing'

  return (
    <form onSubmit={handleSubmit} className="border-t border-zinc-800 bg-zinc-950 p-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 shadow-lg shadow-black/20 focus-within:border-zinc-600">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handleKeyDown}
          className="block min-h-[88px] w-full resize-none rounded-t-lg bg-transparent px-3 py-3 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-600"
          placeholder="Describe the coding task..."
          disabled={submitting}
        />

        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 px-3 py-2">
          <div
            className={`inline-flex min-h-7 items-center rounded-md border px-2.5 text-xs font-medium ${TIER_STYLES[effectiveTier]}`}
            title={routingDecision?.reasoning ?? 'Router preview'}
          >
            {modelBadgeText}
          </div>

          <select
            value={modelOverride}
            onChange={(event) => setModelOverride(event.target.value)}
            className="h-7 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200 outline-none hover:bg-zinc-900 focus:border-blue-500"
            aria-label="Model override"
          >
            <option value="">Auto</option>
            {groupedModelOptions.map((group) => (
              <optgroup key={group.agentId} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {busyReason ? (
            <span className="truncate text-xs text-zinc-500">{busyReason}</span>
          ) : routingDecision?.reasoning ? (
            <span className="truncate text-xs text-zinc-500">{routingDecision.reasoning}</span>
          ) : (
            <span className="text-xs text-zinc-600">Command+Enter to run</span>
          )}

          <button
            type="submit"
            disabled={!prompt.trim() || submitting || busy}
            className="ml-auto inline-flex h-8 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            {buttonLabel}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-2 rounded-md border border-red-900/70 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      ) : null}

      <span className="sr-only" aria-live="polite">
        {effectiveModel}
      </span>
    </form>
  )
}

function catalogOptions(catalogs: AgentModelCatalog[]): ModelOption[] {
  return catalogs.flatMap((catalog) =>
    catalog.models.map((model) => ({
      key: `${catalog.agentId}:${model.id}`,
      value: model.id,
      label: model.label,
      agentId: catalog.agentId,
      agentName: catalog.name,
      tier: model.tier,
    })),
  )
}

function groupModelOptions(catalogs: AgentModelCatalog[]) {
  return catalogs
    .filter((catalog) => catalog.installed && catalog.models.length > 0)
    .map((catalog) => ({
      agentId: catalog.agentId,
      label: catalog.name,
      options: catalogOptions([catalog]),
    }))
}
