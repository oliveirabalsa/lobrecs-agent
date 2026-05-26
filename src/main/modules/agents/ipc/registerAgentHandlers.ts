import { ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { modelTierFromModel } from '../../../router'
import { capacityFallbackModelsForAgent } from '../../../router/modelCapacityFallbacks'
import { feedbackStore, projectsStore, sessionsStore } from '../../../store'
import { delegateTask } from '../application/delegateTask'
import {
  getAgentProfile,
  listAgentProfiles,
  promptWithAgentProfile,
} from '../application/agentProfileService'
import { listAgentModelCatalogs } from '../application/listAgentModelCatalogs'
import { submitPlanDecision } from '../../../swarm/planPrompt'
import { submitStepApprovalDecision } from '../../../swarm/stepApprovalPrompt'
import { requireProject } from '../../projects/application/requireProject'
import type { MainIpcContext } from '../../shared/ipcContext'
import { listCapabilities } from '../../system/ipc/registerSystemHandlers'
import {
  runtimeSettingsWithApprovalMode,
  runtimeSettingsWithThinkingLevel,
} from '../domain/approvalMode'
import { isSupportedAgentId } from '../domain/isSupportedAgentId'
import {
  validateAgentDispatchParams,
  validateEnqueueParams,
  validateSessionId,
  validateSteerParams,
  validateThreadId,
} from '../../../../shared/types'
import type {
  AgentDispatchParams,
  AgentDelegateTaskParams,
  AgentModelRecoveryDecisionPayload,
  AgentPlanDecisionPayload,
  AgentPlanReviewDecisionPayload,
  EnqueueParams,
  ImageAttachment,
  QueuedMessage,
  SpawnedAgentSession,
  SteerParams,
  SupportedAgentId,
  SwarmStepApprovalDecisionPayload,
} from '../../../../shared/types'

async function normalizeImageAttachments(
  images: ImageAttachment[] | undefined,
  limits: { maxCount: number; maxSizeMb: number },
): Promise<ImageAttachment[]> {
  const normalized: ImageAttachment[] = []
  const seen = new Set<string>()
  const maxBytes = limits.maxSizeMb * 1024 * 1024

  for (const image of images ?? []) {
    if (!image?.filePath || typeof image.filePath !== 'string') continue
    const filePath = path.resolve(image.filePath)
    const key = `${filePath}:${image.name ?? ''}:${image.size ?? ''}`

    if (seen.has(key)) continue

    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) continue

      normalized.push({
        filePath,
        name: image.name ?? path.basename(filePath),
        mimeType: image.mimeType,
        size: stat.size,
      })
    } catch {
      continue
    }
    seen.add(key)

    if (normalized.length >= limits.maxCount) break
  }

  return normalized
}

export function registerAgentHandlers(context: MainIpcContext): void {
  ipcMain.handle(
    'agent:dispatch',
    async (
      _event,
      rawParams: unknown,
    ) => {
      const params = validateAgentDispatchParams(rawParams)
      const project = requireProject(params.projectId)
      const settings = context.settingsService.getEffective(project.id).settings
      const profile = await getAgentProfile(project.id, params.profileId)
      if (params.profileId && !profile) {
        throw new Error(`Agent profile not found: ${params.profileId}`)
      }
      const prompt = promptWithAgentProfile(params.prompt, profile)
      const approvalMode = params.approvalMode ?? profile?.approvalMode
      const thinking = params.thinking ?? profile?.thinking
      const imageAttachments = await normalizeImageAttachments(
        params.imageAttachments,
        settings.agents.imageAttachments,
      )
      const userPickedAgent = isSupportedAgentId(params.agentId)
      const preferredAgentId = userPickedAgent
        ? (params.agentId as SupportedAgentId)
        : profile?.defaultAgentId ?? settings.agents.defaultAgentId
      const recentFailures = feedbackStore.getRecentFailures(project.id).map((failure) => ({
        prompt: failure.prompt,
        tier: modelTierFromModel(failure.model),
        failed: true,
      }))
      const decision = await context.modelRouter.route({
        prompt,
        preferredAgentId,
        requiresImageSupport: imageAttachments.length > 0,
        modelOverride: params.modelOverride ?? profile?.defaultModel,
        projectId: project.id,
        recentFailures,
        autoAgentSelection: !userPickedAgent && !params.modelOverride,
      })

      if (imageAttachments.length > 0 && !context.modelRouter.supportsImages(decision.agentId, decision.model)) {
        throw new Error(`Image attachments are not supported by the selected agent/model (${decision.agentId} - ${decision.model})`)
      }

      const runtimeSettings = runtimeSettingsWithApprovalMode(
        runtimeSettingsWithThinkingLevel(
          settings.agents.runtimes[decision.agentId],
          decision.agentId,
          thinking,
        ),
        approvalMode,
        settings.execution.defaultApprovalMode,
      )

      const { sessionId, threadId } = await context.sessionManager.dispatch({
        projectId: project.id,
        prompt,
        agentId: decision.agentId,
        model: decision.model,
        modelFallbacks: capacityFallbackModelsForAgent({
          settings,
          agentId: decision.agentId,
          currentModel: decision.model,
          requiresImageSupport: imageAttachments.length > 0,
        }),
        repoPath: project.repoPath,
        imageAttachments,
        context: projectsStore.getContext(project.id),
        threadId: params.threadId,
        isolate: settings.execution.worktreeIsolation,
        runtimeSettings,
        planMode: params.planMode,
        spawnedAgent: normalizeSpawnedAgent(params.spawnedAgent),
        returnAfterSessionCreated: true,
      })

      return { sessionId, threadId }
    },
  )

  ipcMain.handle(
    'agent:delegate-task',
    async (_event, params: AgentDelegateTaskParams) => delegateTask(context, params),
  )
  ipcMain.handle('agent:list-profiles', async (_event, rawInput: unknown) => {
    const projectId = typeof rawInput === 'string'
      ? rawInput
      : rawInput && typeof rawInput === 'object'
        ? (rawInput as { projectId?: unknown }).projectId
        : undefined
    if (typeof projectId !== 'string') throw new Error('Project id is required.')
    const [capabilities, modelCatalogs] = await Promise.all([
      listCapabilities(context),
      listAgentModelCatalogs(context),
    ])
    return listAgentProfiles({ projectId, capabilities, modelCatalogs })
  })
  ipcMain.handle('agent:approve', async (_event, rawSessionId: unknown) => {
    const sessionId = validateSessionId(rawSessionId)
    context.sessionManager.approve(sessionId)
  })
  ipcMain.handle('agent:reject', async (_event, rawSessionId: unknown) => {
    const sessionId = validateSessionId(rawSessionId)
    context.sessionManager.reject(sessionId)
  })
  ipcMain.handle('agent:cancel', async (_event, rawSessionId: unknown) => {
    const sessionId = validateSessionId(rawSessionId)
    context.sessionManager.cancel(sessionId)
  })
  ipcMain.handle('agent:kill-all', async () => {
    context.sessionManager.cancelAll()
  })
  ipcMain.handle(
    'agent:plan-decision',
    async (_event, payload: AgentPlanDecisionPayload) => {
      submitPlanDecision(payload)
    },
  )
  ipcMain.handle(
    'agent:plan-review-decision',
    async (_event, payload: AgentPlanReviewDecisionPayload) => {
      const review = context.sessionManager.getPendingPlanReview(payload.reviewId)
      if (payload.decision !== 'approve' || !review) {
        return context.sessionManager.resolvePlanReview(payload)
      }

      const executionAgentId = isSupportedAgentId(payload.agentId)
        ? payload.agentId
        : isSupportedAgentId(review.agentId)
          ? review.agentId
          : null
      if (!executionAgentId) {
        return context.sessionManager.resolvePlanReview(payload)
      }

      const settings = context.settingsService.getEffective(review.projectId).settings
      const executionModel = payload.modelOverride ?? review.model
      const runtimeSettings = runtimeSettingsWithApprovalMode(
        settings.agents.runtimes[executionAgentId],
        undefined,
        review.runtimePermissionMode ?? settings.execution.defaultApprovalMode,
      )

      return context.sessionManager.resolvePlanReview(payload, {
        runtimeSettings,
        modelFallbacks: capacityFallbackModelsForAgent({
          settings,
          agentId: executionAgentId,
          currentModel: executionModel,
        }),
      })
    },
  )
  ipcMain.handle(
    'agent:model-recovery-decision',
    async (_event, payload: AgentModelRecoveryDecisionPayload) => {
      const session = sessionsStore.get(payload.sessionId)
      if (
        payload.decision !== 'continue' ||
        !session ||
        !payload.agentId ||
        !payload.modelOverride
      ) {
        return context.sessionManager.resolveModelRecovery(payload)
      }

      const settings = context.settingsService.getEffective(session.projectId).settings
      const runtimeSettings = runtimeSettingsWithApprovalMode(
        settings.agents.runtimes[payload.agentId],
        undefined,
        settings.execution.defaultApprovalMode,
      )

      return context.sessionManager.resolveModelRecovery(payload, {
        runtimeSettings,
        modelFallbacks: capacityFallbackModelsForAgent({
          settings,
          agentId: payload.agentId,
          currentModel: payload.modelOverride,
          requiresImageSupport: (session.imageAttachments?.length ?? 0) > 0,
        }),
        validateSelection: (agentId, model) => {
          if (
            (session.imageAttachments?.length ?? 0) > 0 &&
            !context.modelRouter.supportsImages(agentId, model)
          ) {
            throw new Error(
              `Image attachments are not supported by the selected agent/model (${agentId} - ${model})`,
            )
          }
        },
      })
    },
  )
  ipcMain.handle(
    'swarm:step-approval-decision',
    async (_event, payload: SwarmStepApprovalDecisionPayload) => {
      return submitStepApprovalDecision(payload)
    },
  )

  ipcMain.handle(
    'agent:enqueue',
    async (_event, rawParams: unknown): Promise<QueuedMessage> => {
      const params: EnqueueParams = validateEnqueueParams(rawParams)
      const project = requireProject(params.projectId)
      const settings = context.settingsService.getEffective(project.id).settings
      const profile = await getAgentProfile(project.id, params.profileId)
      if (params.profileId && !profile) {
        throw new Error(`Agent profile not found: ${params.profileId}`)
      }
      const prompt = promptWithAgentProfile(params.prompt, profile)
      const approvalMode = params.approvalMode ?? profile?.approvalMode
      const thinking = params.thinking ?? profile?.thinking
      const userPickedAgent = isSupportedAgentId(params.agentId)
      const preferredAgentId = userPickedAgent
        ? (params.agentId as SupportedAgentId)
        : profile?.defaultAgentId ?? settings.agents.defaultAgentId
      const recentFailures = feedbackStore.getRecentFailures(project.id).map((failure) => ({
        prompt: failure.prompt,
        tier: modelTierFromModel(failure.model),
        failed: true,
      }))
      const decision = await context.modelRouter.route({
        prompt,
        preferredAgentId,
        requiresImageSupport: false,
        modelOverride: params.modelOverride ?? profile?.defaultModel,
        projectId: project.id,
        recentFailures,
        autoAgentSelection: !userPickedAgent && !params.modelOverride,
      })

      if (
        context.sessionManager.getQueue(params.threadId).length >=
        settings.execution.maxQueuedMessagesPerThread
      ) {
        throw new Error('Thread message queue is full')
      }

      const runtimeSettings = runtimeSettingsWithApprovalMode(
        runtimeSettingsWithThinkingLevel(
          settings.agents.runtimes[decision.agentId],
          decision.agentId,
          thinking,
        ),
        approvalMode,
        settings.execution.defaultApprovalMode,
      )

      return context.sessionManager.enqueueMessage(
        {
          prompt,
          agentId: decision.agentId,
          model: decision.model,
          profileId: params.profileId,
          approvalMode,
          thinking,
          runtimeSettings,
        },
        params.threadId,
      )
    },
  )

  ipcMain.handle(
    'agent:queue-status',
    async (_event, rawThreadId: unknown): Promise<QueuedMessage[]> => {
      const threadId = validateThreadId(rawThreadId)
      return context.sessionManager.getQueue(threadId)
    },
  )

  ipcMain.handle(
    'agent:dequeue-item',
    async (_event, payload: { threadId: string; messageId: string }) => {
      validateThreadId(payload.threadId)
      validateSessionId(payload.messageId)
      context.sessionManager.removeQueueItem(payload.threadId, payload.messageId)
    },
  )

  ipcMain.handle('agent:clear-queue', async (_event, rawThreadId: unknown) => {
    const threadId = validateThreadId(rawThreadId)
    context.sessionManager.clearQueue(threadId)
  })

  ipcMain.handle('agent:steer', async (_event, rawParams: unknown) => {
    const params: SteerParams = validateSteerParams(rawParams)
    const session = sessionsStore.get(params.sessionId)
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`)
    }

    const project = requireProject(session.projectId)
    const settings = context.settingsService.getEffective(project.id).settings
    const profile = await getAgentProfile(project.id, params.profileId)
    if (params.profileId && !profile) {
      throw new Error(`Agent profile not found: ${params.profileId}`)
    }
    const prompt = promptWithAgentProfile(params.prompt, profile)
    const approvalMode = params.approvalMode ?? profile?.approvalMode
    const thinking = params.thinking ?? profile?.thinking
    const preferredAgentId = isSupportedAgentId(params.agentId)
      ? params.agentId
      : profile?.defaultAgentId ?? session.agentId
    const recentFailures = feedbackStore.getRecentFailures(project.id).map((failure) => ({
      prompt: failure.prompt,
      tier: modelTierFromModel(failure.model),
      failed: true,
    }))
    const decision = await context.modelRouter.route({
      prompt,
      preferredAgentId,
      requiresImageSupport: false,
      modelOverride: params.modelOverride ?? profile?.defaultModel,
      projectId: project.id,
      recentFailures,
    })

    const runtimeSettings = runtimeSettingsWithApprovalMode(
      runtimeSettingsWithThinkingLevel(
        settings.agents.runtimes[decision.agentId],
        decision.agentId,
        thinking,
      ),
      approvalMode,
      settings.execution.defaultApprovalMode,
    )

    return context.sessionManager.steer({
      sessionId: params.sessionId,
      projectId: session.projectId,
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
      isolate: settings.execution.worktreeIsolation,
      runtimeSettings,
    })
  })
}

function normalizeSpawnedAgent(value: AgentDispatchParams['spawnedAgent']): SpawnedAgentSession | undefined {
  if (!value) return undefined
  if (value.kind !== 'swarm' && value.kind !== 'quality-repair' && value.kind !== 'delegation') {
    return undefined
  }
  const role = typeof value.role === 'string' ? value.role.trim() : ''
  return role ? { kind: value.kind, role } : undefined
}
