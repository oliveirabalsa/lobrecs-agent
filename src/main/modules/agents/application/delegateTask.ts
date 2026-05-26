import { randomUUID } from 'node:crypto'
import { modelTierFromModel } from '../../../router'
import { capacityFallbackModelsForAgent } from '../../../router/modelCapacityFallbacks'
import { feedbackStore, projectsStore, sessionsStore } from '../../../store'
import { requireProject } from '../../projects/application/requireProject'
import type { MainIpcContext } from '../../shared/ipcContext'
import {
  getAgentProfile,
  promptWithAgentProfile,
} from './agentProfileService'
import {
  runtimeSettingsWithApprovalMode,
  runtimeSettingsWithThinkingLevel,
} from '../domain/approvalMode'
import type {
  AgentDelegateTaskParams,
  AgentDelegateTaskResult,
} from '../../../../shared/types'

export async function delegateTask(
  context: MainIpcContext,
  params: AgentDelegateTaskParams,
): Promise<AgentDelegateTaskResult> {
  const project = requireProject(params.projectId)
  const parentSession = sessionsStore.get(params.parentSessionId)
  if (!parentSession) {
    throw new Error(`Parent session not found: ${params.parentSessionId}`)
  }
  if (parentSession.projectId !== project.id || parentSession.threadId !== params.threadId) {
    throw new Error('Delegated task must belong to the parent session thread')
  }

  const goal = params.goal.trim()
  if (!goal) {
    throw new Error('Delegated task goal is required')
  }

  const settings = context.settingsService.getEffective(project.id).settings
  const profile = await getAgentProfile(project.id, params.profileId)
  if (params.profileId && !profile) {
    throw new Error(`Agent profile not found: ${params.profileId}`)
  }
  const prompt = promptWithAgentProfile(buildDelegatedTaskPrompt(goal, params.context), profile)
  const recentFailures = feedbackStore.getRecentFailures(project.id).map((failure) => ({
    prompt: failure.prompt,
    tier: modelTierFromModel(failure.model),
    failed: true,
  }))
  const decision = await context.modelRouter.route({
    prompt,
    preferredAgentId: profile?.defaultAgentId ?? settings.agents.defaultAgentId,
    modelOverride: profile?.defaultModel,
    projectId: project.id,
    recentFailures,
    autoAgentSelection: true,
  })
  const runtimeSettings = runtimeSettingsWithApprovalMode(
    runtimeSettingsWithThinkingLevel(
      settings.agents.runtimes[decision.agentId],
      decision.agentId,
      params.thinking ?? profile?.thinking,
    ),
    params.approvalMode ?? profile?.approvalMode ?? 'auto-safe',
    settings.execution.defaultApprovalMode,
  )
  const delegationId = randomUUID()

  const { sessionId, threadId } = await context.sessionManager.dispatch({
    projectId: project.id,
    prompt,
    agentId: decision.agentId,
    model: decision.model,
    modelFallbacks: capacityFallbackModelsForAgent({
      settings,
      agentId: decision.agentId,
      currentModel: decision.model,
    }),
    repoPath: project.repoPath,
    context: projectsStore.getContext(project.id),
    contextQuery: goal,
    threadId: params.threadId,
    isolate: settings.execution.worktreeIsolation,
    runtimeSettings,
    spawnedAgent: { kind: 'delegation', role: summarizeDelegationGoal(goal) },
    delegatedTask: {
      delegationId,
      parentSessionId: parentSession.id,
      goal,
    },
  })

  return {
    sessionId,
    threadId,
    delegationId,
    agentId: decision.agentId,
    model: decision.model,
  }
}

export function buildDelegatedTaskPrompt(
  goal: string,
  context: string | undefined,
): string {
  const lines = [
    '[Delegated task]',
    '',
    'Goal:',
    goal,
    '',
    'Instructions:',
    '- Work independently from the parent agent and focus only on this delegated goal.',
    '- Return a concise final summary with concrete findings, decisions, or next steps.',
    '- Do not ask the user questions; state assumptions if the task is under-specified.',
    '- Do not modify files unless the delegated goal explicitly asks for code changes.',
    '- When writing your final summary, describe only the changes you made during this task — do not cite git status counts, untracked totals, or aggregate working-tree numbers, since those reflect pre-existing state.',
  ]

  const trimmedContext = context?.trim()
  if (trimmedContext) {
    lines.splice(4, 0, '', 'Context from parent:', trimmedContext)
  }

  return lines.join('\n')
}

function summarizeDelegationGoal(goal: string): string {
  const normalized = goal.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 64) return normalized
  return `${normalized.slice(0, 61)}...`
}
