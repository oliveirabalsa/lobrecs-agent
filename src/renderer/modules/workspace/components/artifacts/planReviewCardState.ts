import type {
  AgentDispatchResult,
  AgentPlanReviewDecisionPayload,
  SupportedAgentId,
} from '../../../../../shared/types'
import { SUPPORTED_AGENT_IDS } from '../../../../../shared/types'
import type { MultitaskDecomposeRequest } from '../../../../../shared/contracts/multitask'
import { formatModelLabel } from '../Composer/modelDisplay'
import type { ModelGroup, ModelOption, ModelSelection } from '../Composer/types'
import type { MarkdownPreviewDocument } from '../MarkdownPreviewer'

export type PlanReviewOutcome = 'approved' | 'rejected' | 'stale'

export function resolvePlanReviewOutcome(
  choice: 'approve' | 'reject',
  result: AgentDispatchResult | null,
): PlanReviewOutcome {
  if (choice === 'reject') return 'rejected'
  return result ? 'approved' : 'stale'
}

export function normalizePlanReviewText(
  value: string | null | undefined,
): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

export function buildPlanReviewDecisionPayload(input: {
  reviewId: string
  sessionId: string
  choice: 'approve' | 'reject'
  originalPlanText?: string
  editedPlanText?: string
  suggestionText?: string
  planningAgentId?: string
  agentOverride?: string
  planningModel?: string
  modelOverride?: string
}): AgentPlanReviewDecisionPayload {
  const payload: AgentPlanReviewDecisionPayload = {
    reviewId: input.reviewId,
    sessionId: input.sessionId,
    decision: input.choice,
  }

  if (input.choice !== 'approve') return payload

  const originalPlanText = normalizePlanReviewText(input.originalPlanText)
  const editedPlanText = normalizePlanReviewText(input.editedPlanText)
  const suggestionText = normalizePlanReviewText(input.suggestionText)

  if (editedPlanText && editedPlanText !== originalPlanText) {
    payload.editedPlanText = editedPlanText
  }
  if (suggestionText) payload.suggestionText = suggestionText
  if (
    isSupportedAgentId(input.agentOverride) &&
    input.agentOverride !== input.planningAgentId &&
    input.modelOverride
  ) {
    payload.agentId = input.agentOverride
  }
  if (
    input.modelOverride &&
    (input.modelOverride !== input.planningModel || payload.agentId)
  ) {
    payload.modelOverride = input.modelOverride
  }

  return payload
}

export function buildPlanReviewMultitaskRequest(input: {
  projectId: string
  planText: string
  threadId?: string | null
}): MultitaskDecomposeRequest {
  return {
    projectId: input.projectId,
    prompt: input.planText,
    ...(input.threadId ? { threadId: input.threadId } : {}),
  }
}

export function toPlanReviewMarkdownDocument(
  planText: string,
): MarkdownPreviewDocument {
  const normalized = planText.trim()
  return {
    title: 'Plan review.md',
    content: normalized || '_No plan text was captured for this review._',
    sourceLabel: 'Plan review',
    suggestedFileName: 'plan-review.md',
  }
}

export function isSupportedAgentId(value: unknown): value is SupportedAgentId {
  return typeof value === 'string' && SUPPORTED_AGENT_IDS.includes(value as SupportedAgentId)
}

export function selectPlanReviewModel(
  groups: readonly ModelGroup[],
  planningAgentId?: SupportedAgentId,
  planningModel?: string,
): ModelSelection | null {
  const plannedOption = groups
    .find((group) => group.agentId === planningAgentId)
    ?.options.find((option) => option.modelId === planningModel)
  const sameAgentOption = groups.find((group) => group.agentId === planningAgentId)
    ?.options[0]
  const fallbackOption = plannedOption ?? sameAgentOption ?? groups[0]?.options[0]

  if (fallbackOption) {
    return {
      kind: 'manual',
      agentId: fallbackOption.agentId,
      modelId: fallbackOption.modelId,
    }
  }

  if (planningAgentId && planningModel) {
    return { kind: 'manual', agentId: planningAgentId, modelId: planningModel }
  }

  return null
}

export function findPlanReviewManualOption(
  groups: readonly ModelGroup[],
  selection: ModelSelection | null,
): ModelOption | null {
  if (selection?.kind !== 'manual') return null

  const option = groups
    .find((group) => group.agentId === selection.agentId)
    ?.options.find((candidate) => candidate.modelId === selection.modelId)

  if (option) return option

  return {
    key: `${selection.agentId}:${selection.modelId}`,
    agentId: selection.agentId,
    agentName: selection.agentId,
    modelId: selection.modelId,
    label: formatModelLabel(selection.agentId, selection.modelId),
    tier: 'balanced',
  }
}
