import { useEffect, useState } from 'react'
import type {
  AgentActivity,
  AgentModel,
  SupportedAgentId,
  SwarmStepApprovalDecisionPayload,
} from '../../../../../shared/types'
import { SUPPORTED_AGENT_IDS } from '../../../../../shared/types'
import { Button } from '../../../../components/ui'
import { AgentModelPicker, type AgentModelSelection } from './AgentModelPicker'

export type SwarmStepApprovalActivity = Extract<
  AgentActivity,
  { kind: 'swarm-step-approval' }
>

export interface SwarmStepApprovalCardProps {
  approval: SwarmStepApprovalActivity
  /** Session that emitted the approval — echoed back in the decision payload. */
  sessionId: string
}

type CardOutcome = 'continued' | 'cancelled' | 'stale'

function toSupportedAgentId(value: string | undefined): SupportedAgentId | undefined {
  return value && (SUPPORTED_AGENT_IDS as readonly string[]).includes(value)
    ? (value as SupportedAgentId)
    : undefined
}

/**
 * Chooses the initial selection shown in the model picker.
 *
 * The approval activity carries `approval.nextAgentId` + `approval.nextModel` —
 * what the manager plan says should run next. The picker also lets the user
 * jump to a different agent entirely, so the initial selection is the planned
 * (agent, model) pair when both are present.
 */
function selectInitialModel(
  approval: SwarmStepApprovalActivity,
): AgentModelSelection | null {
  // TODO(daisy): refine the initial selection rule.
  //
  // Today: return the planned (nextAgentId, nextModel) pair when both are
  // present, otherwise `null` so the picker shows a placeholder.
  //
  // Options to consider:
  //   - Keep as-is. Simplest; the picker reflects the plan exactly.
  //   - Validate `nextModel` against the loaded catalog before selecting it,
  //     and fall back to the catalog's first entry for that agent when the
  //     planned model is no longer installed.
  //   - Bias toward a tier (e.g. "advanced") rather than the planned model
  //     when the next role is `implementer`, since implementers benefit from
  //     stronger models than planners.
  //
  // 5–10 lines of business logic. Pure (no IPC). Called once at mount and
  // optionally re-applied in the catalog-load effect below.
  const agentId = toSupportedAgentId(approval.nextAgentId)
  if (!agentId || !approval.nextModel) return null
  return { agentId, modelId: approval.nextModel }
}

export function SwarmStepApprovalCard({
  approval,
  sessionId,
}: SwarmStepApprovalCardProps) {
  const [outcome, setOutcome] = useState<CardOutcome | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [editedPromptSuffix, setEditedPromptSuffix] = useState(
    approval.nextPromptSuffix ?? '',
  )
  const [agentModels, setAgentModels] = useState<AgentModel[]>([])
  const [selectedModel, setSelectedModel] = useState<AgentModelSelection | null>(
    () => selectInitialModel(approval),
  )

  useEffect(() => {
    let cancelled = false
    window.agentforge.system
      .listAgentModels()
      .then((catalogs) => {
        if (cancelled) return
        setAgentModels(catalogs.flatMap((catalog) => catalog.models))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  async function decide(decision: 'continue' | 'cancel'): Promise<void> {
    if (pending || outcome !== null) return
    setPending(true)
    setError(null)
    try {
      const payload: SwarmStepApprovalDecisionPayload = {
        approvalId: approval.approvalId,
        sessionId,
        decision,
      }
      if (decision === 'continue') {
        const trimmed = editedPromptSuffix.trim()
        const original = (approval.nextPromptSuffix ?? '').trim()
        if (trimmed && trimmed !== original) payload.editedPromptSuffix = trimmed
        if (selectedModel && selectedModel.modelId !== approval.nextModel) {
          payload.modelOverride = selectedModel.modelId
        }
      }
      const accepted = await window.agentforge.agent.stepApprovalDecision(payload)
      setOutcome(
        decision === 'cancel'
          ? 'cancelled'
          : accepted
            ? 'continued'
            : 'stale',
      )
    } catch (decisionError: unknown) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : 'Failed to submit approval decision',
      )
    } finally {
      setPending(false)
    }
  }

  if (outcome !== null) {
    return (
      <article className="self-start overflow-hidden rounded-card border border-hairline bg-card">
        <div className="px-3 py-2.5 text-xs text-muted">
          {outcomeText(outcome, approval.nextRole)}
        </div>
      </article>
    )
  }

  return (
    <article className="self-start max-w-[min(620px,100%)] overflow-hidden rounded-card border border-hairline bg-card shadow-elevated">
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-accent-primary/30 bg-accent-primary/15 text-accent-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M8 12h8" />
            <path d="m12 8 4 4-4 4" />
          </svg>
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-primary">
            {capitalize(approval.completedRole)} finished — continue to {approval.nextRole}?
          </div>
          <div className="text-[11px] text-muted">
            Review or refine the next step's instructions before it runs.
          </div>
        </div>
        <div className="ml-auto rounded-pill border border-accent-primary/25 bg-accent-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-primary">
          Swarm gate
        </div>
      </header>

      <div className="grid gap-3 px-4 py-3">
        {editingPrompt ? (
          <label className="grid gap-1 rounded-card border border-hairline bg-card-raised px-3 py-3">
            <span className="text-[11px] text-secondary">
              Instructions for {approval.nextRole}
            </span>
            <textarea
              value={editedPromptSuffix}
              onChange={(event) => setEditedPromptSuffix(event.currentTarget.value)}
              rows={6}
              placeholder="Refine what the next agent should focus on."
              className="min-h-[96px] rounded-card border border-hairline bg-card px-3 py-2 text-xs leading-5 text-primary outline-none ring-accent-primary/40 transition placeholder:text-muted focus:border-accent-primary/40 focus:ring-2"
            />
          </label>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {agentModels.length > 1 ? (
              <AgentModelPicker
                models={agentModels}
                selectedModel={selectedModel}
                onSelect={setSelectedModel}
              />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditingPrompt((v) => !v)}
              disabled={pending}
            >
              {editingPrompt ? 'Close editor' : 'Edit instructions'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void decide('cancel')}
              disabled={pending}
            >
              Cancel swarm
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void decide('continue')}
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

function outcomeText(outcome: CardOutcome, nextRole: string): string {
  if (outcome === 'continued') return `Continuing to ${nextRole}…`
  if (outcome === 'cancelled') return 'Swarm cancelled at this step.'
  return 'This approval is no longer pending.'
}

function capitalize(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}
