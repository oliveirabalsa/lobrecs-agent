import { useEffect, useMemo, useState } from 'react'
import type {
  AgentModel,
  AgentModelCatalog,
  AgentModelRecoveryDecisionPayload,
  SupportedAgentId,
} from '../../../../../shared/types'
import { Button } from '../../../../components/ui'
import type { StartedSessionSummary } from '../../../sessions/types'
import { FALLBACK_MODEL_CATALOGS } from '../Composer/modelCatalog'
import {
  AgentModelPicker,
  type AgentModelSelection,
  shortAgentModelLabel,
} from './AgentModelPicker'

export interface ModelRecoveryActivity {
  kind: 'model-recovery'
  recoveryId: string
  failedAgentId: string
  failedModel: string
  reason: string
  requiresImageSupport?: boolean
}

export interface ModelRecoveryCardProps {
  recovery: ModelRecoveryActivity
  sessionId: string
  onSessionStarted?: (session: StartedSessionSummary) => void
}

type RecoveryDecision = 'continued' | 'cancelled' | 'stale'

export function ModelRecoveryCard({
  recovery,
  sessionId,
  onSessionStarted,
}: ModelRecoveryCardProps) {
  const [decision, setDecision] = useState<RecoveryDecision | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [catalogs, setCatalogs] = useState<AgentModelCatalog[]>(FALLBACK_MODEL_CATALOGS)
  const models = useMemo(() => recoveryModels(catalogs, recovery), [catalogs, recovery])
  const [selectedModel, setSelectedModel] = useState<AgentModelSelection | null>(() =>
    defaultRecoveryModel(recoveryModels(FALLBACK_MODEL_CATALOGS, recovery)),
  )

  useEffect(() => {
    let cancelled = false
    window.agentforge.system
      .listAgentModels()
      .then((nextCatalogs) => {
        if (cancelled) return
        if (nextCatalogs.some((catalog) => catalog.models.length > 0)) {
          setCatalogs(nextCatalogs)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (selectedModel || models.length === 0) return
    setSelectedModel(defaultRecoveryModel(models))
  }, [models, selectedModel])

  async function decide(choice: AgentModelRecoveryDecisionPayload['decision']) {
    if (pending || decision !== null) return

    setPending(true)
    setError(null)
    try {
      const result = await window.agentforge.agent.modelRecoveryDecision({
        recoveryId: recovery.recoveryId,
        sessionId,
        decision: choice,
        agentId: choice === 'continue' ? selectedModel?.agentId : undefined,
        modelOverride: choice === 'continue' ? selectedModel?.modelId : undefined,
      })

      if (choice === 'cancel') {
        setDecision('cancelled')
        return
      }
      if (!result) {
        setDecision('stale')
        return
      }

      const session = await window.agentforge.sessions.get(result.sessionId)
      setDecision('continued')
      if (session) {
        onSessionStarted?.({
          sessionId: session.id,
          threadId: result.threadId,
          prompt: session.prompt,
          imageAttachments: session.imageAttachments,
          routingDecision: null,
          agentId: selectedModel?.agentId,
          modelOverride: selectedModel?.modelId,
          planMode: session.planMode,
          createdAt: session.createdAt,
        })
      }
    } catch (decisionError: unknown) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : 'Failed to continue with another model',
      )
    } finally {
      setPending(false)
    }
  }

  if (decision !== null) {
    return (
      <article className="self-start overflow-hidden rounded-card border border-hairline bg-card">
        <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted">
          <span
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-card border border-hairline bg-card-raised text-secondary"
            aria-hidden="true"
          >
            {decision === 'continued' ? iconCheck : decision === 'cancelled' ? iconX : iconInfo}
          </span>
          <span>{decisionText(decision)}</span>
        </div>
      </article>
    )
  }

  return (
    <article className="self-start max-w-[min(620px,100%)] overflow-hidden rounded-card border border-accent-warn/35 bg-card shadow-elevated">
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-accent-warn/35 bg-accent-warn/15 text-accent-warn">
          {iconInfo}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-primary">Model limit reached</div>
          <div className="truncate text-[11px] text-muted">
            {recovery.failedAgentId} /{' '}
            {shortAgentModelLabel(
              toSupportedAgentId(recovery.failedAgentId),
              recovery.failedModel,
            )}
          </div>
        </div>
        <div className="ml-auto rounded-pill border border-accent-warn/30 bg-accent-warn/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-warn">
          Paused
        </div>
      </header>

      <div className="grid gap-3 px-4 py-3">
        <p className="break-words text-xs leading-5 text-secondary">
          The provider stopped this run before finishing. Pick another model to continue
          the same task on this thread.
        </p>
        <div className="rounded-card border border-hairline bg-card-raised px-3 py-2 text-[11px] leading-5 text-muted">
          {recovery.reason}
        </div>
        {recovery.requiresImageSupport ? (
          <div className="rounded-card border border-accent-primary/25 bg-accent-primary/10 px-3 py-2 text-[11px] leading-5 text-accent-primary">
            This task includes image attachments; the selected model must support images.
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {selectedModel ? (
            <AgentModelPicker
              models={models}
              selectedModel={selectedModel}
              onSelect={setSelectedModel}
            />
          ) : (
            <div className="rounded-pill border border-hairline bg-card-raised px-2.5 py-1 text-[11px] text-muted">
              Loading models
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void decide('cancel')}
              disabled={pending}
            >
              Dismiss
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void decide('continue')}
              disabled={!selectedModel}
              loading={pending}
            >
              Continue
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-card border border-accent-del/40 bg-accent-del/10 px-3 py-2 text-xs text-accent-del">
            {error}
          </div>
        ) : null}
      </div>
    </article>
  )
}

function recoveryModels(
  catalogs: readonly AgentModelCatalog[],
  recovery: ModelRecoveryActivity,
): AgentModel[] {
  return catalogs
    .flatMap((catalog) => catalog.models)
    .filter(
      (model) =>
        model.agentId !== recovery.failedAgentId || model.id !== recovery.failedModel,
    )
}

function defaultRecoveryModel(models: readonly AgentModel[]): AgentModelSelection | null {
  const [model] = models
  return model ? { agentId: model.agentId, modelId: model.id } : null
}

function toSupportedAgentId(value: string): SupportedAgentId | undefined {
  if (
    value === 'claude-code' ||
    value === 'codex' ||
    value === 'opencode' ||
    value === 'antigravity'
  ) {
    return value
  }

  return undefined
}

function decisionText(decision: RecoveryDecision): string {
  if (decision === 'continued') return 'Continuation started with the selected model.'
  if (decision === 'cancelled') return 'Model recovery dismissed.'
  return 'This recovery prompt is no longer available.'
}

const iconCheck = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m3.5 8.4 2.3 2.3 6.7-6.1" />
  </svg>
)

const iconX = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="m4.3 4.3 7.4 7.4" />
    <path d="m11.7 4.3-7.4 7.4" />
  </svg>
)

const iconInfo = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 7.4v3.2" />
    <path d="M8 5.3h.01" />
  </svg>
)
