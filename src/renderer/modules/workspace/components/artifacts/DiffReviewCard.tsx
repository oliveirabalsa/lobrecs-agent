import { useEffect, useMemo, useState } from 'react'
import type {
  AgentModel,
  AgentModelCatalog,
  GitDiffReviewFinding,
  GitDiffReviewResult,
  SupportedAgentId,
} from '../../../../../shared/types'
import { Button } from '../../../../components/ui'
import { FALLBACK_MODEL_CATALOGS } from '../Composer/modelCatalog'
import { AgentModelPicker, type AgentModelSelection } from './AgentModelPicker'

export type DiffReviewFixSelection = AgentModelSelection

export interface DiffReviewCardProps {
  result: GitDiffReviewResult | null
  loading?: boolean
  error?: string | null
  onReview: () => void | Promise<void>
  onFix: (
    result: GitDiffReviewResult,
    selection: DiffReviewFixSelection,
  ) => void | Promise<void>
  onOpenAgentPanel?: () => void
  defaultFixModel?: DiffReviewFixSelection | null
}

export function DiffReviewCard({
  result,
  loading = false,
  error,
  onReview,
  onFix,
  onOpenAgentPanel,
  defaultFixModel,
}: DiffReviewCardProps) {
  const hasFindings = Boolean(result && result.findings.length > 0)
  const [catalogs, setCatalogs] = useState<AgentModelCatalog[]>(FALLBACK_MODEL_CATALOGS)
  const fixModels = useMemo(() => catalogsToModels(catalogs), [catalogs])
  const [fixPanelOpen, setFixPanelOpen] = useState(false)
  const [fixPending, setFixPending] = useState(false)
  const [fixError, setFixError] = useState<string | null>(null)
  const [selectedFixModel, setSelectedFixModel] =
    useState<DiffReviewFixSelection | null>(() =>
      selectDefaultFixModel(catalogsToModels(FALLBACK_MODEL_CATALOGS), defaultFixModel),
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
    setSelectedFixModel((current) =>
      selectDefaultFixModel(fixModels, current ?? defaultFixModel),
    )
  }, [defaultFixModel, fixModels])

  async function startFix(): Promise<void> {
    if (!result || !selectedFixModel || fixPending) return

    setFixPending(true)
    setFixError(null)
    try {
      await onFix(result, selectedFixModel)
      setFixPanelOpen(false)
    } catch (fixFailure: unknown) {
      setFixError(
        fixFailure instanceof Error
          ? fixFailure.message
          : 'Failed to start a fix session.',
      )
    } finally {
      setFixPending(false)
    }
  }

  return (
    <article className="rounded-card border border-hairline/70 bg-card/40">
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-secondary">Post-run diff check</div>
          <div className="mt-0.5 text-[11px] text-muted">
            Read-only review of the current working tree.
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {hasFindings && result ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFixPanelOpen((open) => !open)
                setFixError(null)
              }}
            >
              Fix with agent
            </Button>
          ) : null}
          {onOpenAgentPanel ? (
            <Button variant="ghost" size="sm" onClick={onOpenAgentPanel}>
              Agents
            </Button>
          ) : null}
          <Button variant="chip" size="sm" loading={loading} onClick={() => void onReview()}>
            {loading ? 'Reviewing' : 'Review'}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="border-t border-hairline/70 px-3 py-2 text-xs leading-5 text-secondary">
          A read-only review is checking the current working tree. Findings will
          appear here without adding raw review output to the chat.
        </div>
      ) : null}

      {error ? (
        <div className="border-t border-accent-del/40 bg-accent-del/10 px-4 py-2 text-xs text-accent-del">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="border-t border-hairline/70 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{result.statusSummary}</span>
            <span>{result.analysis.agentId}</span>
            <span>{result.analysis.model}</span>
            {result.analysis.sessionId ? (
              <span>session {result.analysis.sessionId.slice(0, 8)}</span>
            ) : null}
          </div>
          <div className="mt-2 text-sm leading-6 text-primary">{result.summary}</div>
          {result.findings.length > 0 ? (
            <ol className="mt-3 flex flex-col gap-2">
              {result.findings.map((finding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
            </ol>
          ) : (
            <div className="mt-3 rounded-card border border-accent-add/30 bg-accent-add/10 px-3 py-2 text-xs text-accent-add">
              No concrete findings returned.
            </div>
          )}
          {hasFindings && fixPanelOpen ? (
            <div className="mt-3 rounded-card border border-hairline bg-card-raised px-3 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-primary">Start a fix session</div>
                  <div className="mt-0.5 text-[11px] leading-5 text-muted">
                    The selected model gets the structured findings and current diff context.
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedFixModel && fixModels.length > 0 ? (
                    <AgentModelPicker
                      models={fixModels}
                      selectedModel={selectedFixModel}
                      onSelect={setSelectedFixModel}
                    />
                  ) : (
                    <div className="rounded-pill border border-hairline bg-card px-2.5 py-1 text-[11px] text-muted">
                      Loading models
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFixPanelOpen(false)}
                    disabled={fixPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void startFix()}
                    disabled={!selectedFixModel}
                    loading={fixPending}
                  >
                    Start fix
                  </Button>
                </div>
              </div>
              {fixError ? (
                <div className="mt-3 rounded-card border border-accent-del/40 bg-accent-del/10 px-3 py-2 text-xs text-accent-del">
                  {fixError}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export function selectDefaultFixModel(
  models: readonly AgentModel[],
  preferred?: DiffReviewFixSelection | null,
): DiffReviewFixSelection | null {
  if (preferred && hasModel(models, preferred)) return preferred

  const balanced =
    models.find((model) => model.tier === 'balanced') ??
    models.find((model) => model.tier === 'advanced') ??
    models.find((model) => model.tier === 'frontier')
  const fallback = balanced ?? models[0]

  return fallback ? { agentId: fallback.agentId, modelId: fallback.id } : null
}

function catalogsToModels(catalogs: readonly AgentModelCatalog[]): AgentModel[] {
  return catalogs
    .filter((catalog) => catalog.installed)
    .flatMap((catalog) => catalog.models)
}

function hasModel(
  models: readonly AgentModel[],
  selection: DiffReviewFixSelection,
): boolean {
  return models.some(
    (model) =>
      model.agentId === selection.agentId &&
      model.id === selection.modelId &&
      isSupportedAgentId(model.agentId),
  )
}

function isSupportedAgentId(agentId: string): agentId is SupportedAgentId {
  return (
    agentId === 'claude-code' ||
    agentId === 'codex' ||
    agentId === 'opencode' ||
    agentId === 'antigravity'
  )
}

function FindingRow({ finding }: { finding: GitDiffReviewFinding }) {
  return (
    <li className="rounded-card border border-hairline bg-card-raised px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={severityClass(finding.severity)}>{finding.severity}</span>
        <span className="rounded border border-hairline bg-card px-2 py-0.5 text-[11px] text-secondary">
          {finding.category}
        </span>
        {finding.filePath ? (
          <span className="min-w-0 truncate font-mono text-[11px] text-muted">
            {finding.filePath}
            {finding.line ? `:${finding.line}` : ''}
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-sm font-medium text-primary">{finding.title}</div>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-secondary">
        {finding.detail}
      </p>
      {finding.recommendation ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted">
          {finding.recommendation}
        </p>
      ) : null}
    </li>
  )
}

function severityClass(severity: GitDiffReviewFinding['severity']): string {
  if (severity === 'critical' || severity === 'high') {
    return 'rounded border border-accent-del/40 bg-accent-del/10 px-2 py-0.5 text-[11px] text-accent-del'
  }
  if (severity === 'medium') {
    return 'rounded border border-accent-warn/40 bg-accent-warn/10 px-2 py-0.5 text-[11px] text-accent-warn'
  }
  return 'rounded border border-hairline bg-card px-2 py-0.5 text-[11px] text-secondary'
}
