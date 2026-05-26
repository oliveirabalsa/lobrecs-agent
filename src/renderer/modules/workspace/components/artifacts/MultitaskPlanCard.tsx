import { useEffect, useMemo, useState } from 'react'
import type {
  AgentModel,
  AgentModelCatalog,
  ModelTier,
  MultitaskTask,
  SupportedAgentId,
} from '../../../../../shared/types'
import { AGENT_LABELS } from '../../../../../shared/types'
import { Button } from '../../../../components/ui'
import { FALLBACK_MODEL_CATALOGS } from '../Composer/modelCatalog'
import { formatModelLabel } from '../Composer/modelDisplay'
import { AgentModelPicker, type AgentModelSelection } from './AgentModelPicker'

export interface MultitaskPlanCardProps {
  planId: string
  sessionId: string
  tasks: MultitaskTask[]
  totalEstimatedCostUsd: number
  decomposedBy: { agentId: SupportedAgentId; model: string }
}

type CardOutcome = 'approved' | 'rejected'

const TIER_STYLES: Record<ModelTier, string> = {
  lightweight: 'bg-emerald-500/20 text-emerald-400',
  balanced: 'bg-blue-500/20 text-blue-400',
  advanced: 'bg-purple-500/20 text-purple-400',
  frontier: 'bg-amber-500/20 text-amber-400',
}

function formatCost(usd: number | undefined): string {
  if (usd == null) return '--'
  if (usd < 0.01) return '< $0.01'
  return `$${usd.toFixed(2)}`
}

function agentLabel(agentId: SupportedAgentId): string {
  return AGENT_LABELS[agentId] ?? agentId
}

/**
 * Resolves task titles from a list of task IDs so the dependency indicator
 * can show human-readable labels instead of raw UUIDs.
 */
function dependencyLabels(
  dependsOn: string[],
  allTasks: MultitaskTask[],
): string {
  const labels = dependsOn.map((depId) => {
    const dep = allTasks.find((t) => t.id === depId)
    return dep ? dep.title : depId
  })
  return labels.join(', ')
}

export function replaceMultitaskTaskModel(
  tasks: readonly MultitaskTask[],
  taskId: string,
  selection: AgentModelSelection,
  models: readonly AgentModel[],
): MultitaskTask[] {
  const selectedModel = models.find(
    (model) => model.agentId === selection.agentId && model.id === selection.modelId,
  )

  return tasks.map((task) =>
    task.id === taskId
      ? {
          ...task,
          agentId: selection.agentId,
          model: selection.modelId,
          tier: selectedModel?.tier ?? task.tier,
        }
      : task,
  )
}

function catalogsToModels(catalogs: readonly AgentModelCatalog[]): AgentModel[] {
  return catalogs
    .filter((catalog) => catalog.installed)
    .flatMap((catalog) => catalog.models)
}

export function MultitaskPlanCard({
  planId,
  sessionId,
  tasks,
  totalEstimatedCostUsd,
  decomposedBy,
}: MultitaskPlanCardProps) {
  const tasksVersion = useMemo(
    () => tasks.map((task) => `${task.id}:${task.agentId}:${task.model}`).join('|'),
    [tasks],
  )
  const [editableTasks, setEditableTasks] = useState<MultitaskTask[]>(tasks)
  const [agentModels, setAgentModels] = useState<AgentModel[]>(() =>
    catalogsToModels(FALLBACK_MODEL_CATALOGS),
  )
  const [outcome, setOutcome] = useState<CardOutcome | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setEditableTasks(tasks)
  }, [tasksVersion])

  useEffect(() => {
    let cancelled = false
    window.agentforge.system
      .listAgentModels()
      .then((catalogs) => {
        if (cancelled) return
        const models = catalogsToModels(catalogs)
        if (models.length > 0) setAgentModels(models)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  function handleTaskModelSelect(
    taskId: string,
    selection: AgentModelSelection,
  ): void {
    setEditableTasks((current) =>
      replaceMultitaskTaskModel(current, taskId, selection, agentModels),
    )
  }

  const decide = async (decision: 'approve' | 'reject') => {
    if (pending || outcome !== null) return
    setPending(true)
    setError(null)
    try {
      await window.agentforge.multitask.decision({
        planId,
        sessionId,
        decision,
        editedTasks: decision === 'approve' ? editableTasks : undefined,
      })
      setOutcome(decision === 'approve' ? 'approved' : 'rejected')
    } catch (decisionError: unknown) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : 'Failed to submit multitask decision',
      )
    } finally {
      setPending(false)
    }
  }

  // ── Resolved state ──────────────────────────────────────
  if (outcome !== null) {
    return (
      <article className="self-start overflow-hidden rounded-card border border-hairline bg-card">
        <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted">
          <span
            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-card border ${
              outcome === 'approved'
                ? 'border-accent-primary/30 bg-accent-primary/15 text-accent-primary'
                : 'border-hairline bg-card-raised text-secondary'
            }`}
            aria-hidden="true"
          >
            {outcome === 'approved' ? iconCheck : iconCross}
          </span>
          <span>
            {outcome === 'approved'
              ? `Multitask plan approved. ${editableTasks.length} task${editableTasks.length === 1 ? '' : 's'} dispatched.`
              : 'Multitask plan rejected.'}
          </span>
        </div>
      </article>
    )
  }

  // ── Empty tasks guard ───────────────────────────────────
  if (editableTasks.length === 0) {
    return (
      <article className="self-start max-w-[min(620px,100%)] overflow-hidden rounded-card border border-hairline bg-card shadow-elevated">
        <div className="px-4 py-4 text-xs text-muted">
          No tasks were generated for this multitask plan.
        </div>
      </article>
    )
  }

  // ── Interactive state ───────────────────────────────────
  return (
    <article className="self-start w-full max-w-[min(680px,100%)] overflow-hidden rounded-card border border-accent-primary/30 bg-card shadow-elevated">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-accent-primary/30 bg-accent-primary/15 text-accent-primary">
          {iconGrid}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-primary">
              Multitask Plan
            </span>
            <span className="rounded-pill border border-hairline bg-card-raised px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted">
              {editableTasks.length} task{editableTasks.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="text-[11px] text-muted">
            Decomposed by {agentLabel(decomposedBy.agentId)} /{' '}
            {formatModelLabel(decomposedBy.agentId, decomposedBy.model)}
          </div>
        </div>
        <div className="shrink-0 rounded-pill border border-accent-primary/25 bg-accent-primary/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-accent-primary">
          Est. {formatCost(totalEstimatedCostUsd)}
        </div>
      </header>

      {/* Task list */}
      <div className="grid gap-2 px-4 py-3">
        {editableTasks.map((task, index) => (
          <div
            key={task.id}
            className="rounded-card border border-hairline bg-card-raised px-3 py-2.5"
          >
            <div className="flex items-start gap-2">
              {/* Index */}
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas text-[10px] font-semibold tabular-nums text-muted">
                {index + 1}
              </span>

              <div className="min-w-0 flex-1">
                {/* Title row */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-primary">
                    {task.title}
                  </span>
                  <span
                    className={`rounded-pill px-1.5 py-0.5 text-[10px] font-medium ${TIER_STYLES[task.tier]}`}
                  >
                    {task.tier}
                  </span>
                </div>

                {/* Description */}
                <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted">
                  {task.description}
                </div>

                {/* Meta row */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-secondary">
                  <span className="inline-flex items-center gap-1">
                    {iconAgent}
                    {agentModels.length > 0 ? (
                      <AgentModelPicker
                        models={agentModels}
                        selectedModel={{ agentId: task.agentId, modelId: task.model }}
                        onSelect={(selection) => handleTaskModelSelect(task.id, selection)}
                      />
                    ) : (
                      <>
                        {agentLabel(task.agentId)} /{' '}
                        {formatModelLabel(task.agentId, task.model)}
                      </>
                    )}
                  </span>
                  {task.estimatedCostUsd != null ? (
                    <span className="tabular-nums">
                      {formatCost(task.estimatedCostUsd)}
                    </span>
                  ) : null}
                  {task.dependsOn && task.dependsOn.length > 0 ? (
                    <span
                      className="inline-flex items-center gap-1 text-amber-400"
                      title={`Depends on: ${dependencyLabels(task.dependsOn, editableTasks)}`}
                    >
                      {iconLink}
                      Depends on: {dependencyLabels(task.dependsOn, editableTasks)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void decide('reject')}
          disabled={pending}
        >
          Reject
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void decide('approve')}
          loading={pending}
        >
          Approve & Build
        </Button>
      </div>

      {/* Error */}
      {error ? (
        <div className="mx-4 mb-3 rounded-card border border-accent-del/40 bg-accent-del/10 px-3 py-2 text-xs text-accent-del">
          {error}
        </div>
      ) : null}
    </article>
  )
}

// ── Icons ────────────────────────────────────────────────

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

const iconCross = (
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

const iconGrid = (
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
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
)

const iconAgent = (
  <svg
    width="11"
    height="11"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="8" cy="5.5" r="3" />
    <path d="M2.5 14c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" />
  </svg>
)

const iconLink = (
  <svg
    width="11"
    height="11"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5l-1 1" />
    <path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l1-1" />
  </svg>
)
