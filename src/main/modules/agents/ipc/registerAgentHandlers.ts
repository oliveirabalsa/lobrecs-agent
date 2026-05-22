import { ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { modelTierFromModel } from '../../../router'
import { capacityFallbackModelsForAgent } from '../../../router/modelCapacityFallbacks'
import { feedbackStore, projectsStore, sessionsStore } from '../../../store'
import { submitPlanDecision } from '../../../swarm/planPrompt'
import { requireProject } from '../../projects/application/requireProject'
import type { MainIpcContext } from '../../shared/ipcContext'
import { runtimeSettingsWithApprovalMode } from '../domain/approvalMode'
import { isSupportedAgentId } from '../domain/isSupportedAgentId'
import type {
  AgentDispatchParams,
  AgentId,
  AgentPlanDecisionPayload,
  AgentPlanReviewDecisionPayload,
  EnqueueParams,
  ImageAttachment,
  QueuedMessage,
  SteerParams,
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
      params: AgentDispatchParams & { imageAttachments?: ImageAttachment[]; agentId?: AgentId },
    ) => {
      const project = requireProject(params.projectId)
      const settings = context.settingsService.getEffective(project.id).settings
      const imageAttachments = await normalizeImageAttachments(
        params.imageAttachments,
        settings.agents.imageAttachments,
      )
      const preferredAgentId = isSupportedAgentId(params.agentId)
        ? params.agentId
        : settings.agents.defaultAgentId
      const recentFailures = feedbackStore.getRecentFailures(project.id).map((failure) => ({
        prompt: failure.prompt,
        tier: modelTierFromModel(failure.model),
        failed: true,
      }))
      const decision = await context.modelRouter.route({
        prompt: params.prompt,
        preferredAgentId,
        requiresImageSupport: imageAttachments.length > 0,
        modelOverride: params.modelOverride,
        projectId: project.id,
        recentFailures,
      })

      if (imageAttachments.length > 0 && !context.modelRouter.supportsImages(decision.agentId, decision.model)) {
        throw new Error(`Image attachments are not supported by the selected agent/model (${decision.agentId} - ${decision.model})`)
      }

      const runtimeSettings = runtimeSettingsWithApprovalMode(
        settings.agents.runtimes[decision.agentId],
        params.approvalMode,
        settings.execution.defaultApprovalMode,
      )

      const { sessionId, threadId } = await context.sessionManager.dispatch({
        projectId: project.id,
        prompt: params.prompt,
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
      })

      return { sessionId, threadId }
    },
  )
  ipcMain.handle('agent:approve', async (_event, sessionId: string) => {
    context.sessionManager.approve(sessionId)
  })
  ipcMain.handle('agent:reject', async (_event, sessionId: string) => {
    context.sessionManager.reject(sessionId)
  })
  ipcMain.handle('agent:cancel', async (_event, sessionId: string) => {
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
      return context.sessionManager.resolvePlanReview(payload)
    },
  )

  ipcMain.handle(
    'agent:enqueue',
    async (_event, params: EnqueueParams): Promise<QueuedMessage> => {
      const project = requireProject(params.projectId)
      const settings = context.settingsService.getEffective(project.id).settings
      const preferredAgentId = isSupportedAgentId(params.agentId)
        ? params.agentId
        : settings.agents.defaultAgentId
      const recentFailures = feedbackStore.getRecentFailures(project.id).map((failure) => ({
        prompt: failure.prompt,
        tier: modelTierFromModel(failure.model),
        failed: true,
      }))
      const decision = await context.modelRouter.route({
        prompt: params.prompt,
        preferredAgentId,
        requiresImageSupport: false,
        modelOverride: params.modelOverride,
        projectId: project.id,
        recentFailures,
      })

      if (
        context.sessionManager.getQueue(params.threadId).length >=
        settings.execution.maxQueuedMessagesPerThread
      ) {
        throw new Error('Thread message queue is full')
      }

      const runtimeSettings = runtimeSettingsWithApprovalMode(
        settings.agents.runtimes[decision.agentId],
        params.approvalMode,
        settings.execution.defaultApprovalMode,
      )

      return context.sessionManager.enqueueMessage(
        {
          prompt: params.prompt,
          agentId: decision.agentId,
          model: decision.model,
          approvalMode: params.approvalMode,
          runtimeSettings,
        },
        params.threadId,
      )
    },
  )

  ipcMain.handle(
    'agent:queue-status',
    async (_event, threadId: string): Promise<QueuedMessage[]> => {
      return context.sessionManager.getQueue(threadId)
    },
  )

  ipcMain.handle(
    'agent:dequeue-item',
    async (_event, payload: { threadId: string; messageId: string }) => {
      context.sessionManager.removeQueueItem(payload.threadId, payload.messageId)
    },
  )

  ipcMain.handle('agent:clear-queue', async (_event, threadId: string) => {
    context.sessionManager.clearQueue(threadId)
  })

  ipcMain.handle('agent:steer', async (_event, params: SteerParams) => {
    const session = sessionsStore.get(params.sessionId)
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`)
    }

    const project = requireProject(session.projectId)
    const settings = context.settingsService.getEffective(project.id).settings
    const preferredAgentId = isSupportedAgentId(params.agentId)
      ? params.agentId
      : session.agentId
    const recentFailures = feedbackStore.getRecentFailures(project.id).map((failure) => ({
      prompt: failure.prompt,
      tier: modelTierFromModel(failure.model),
      failed: true,
    }))
    const decision = await context.modelRouter.route({
      prompt: params.prompt,
      preferredAgentId,
      requiresImageSupport: false,
      modelOverride: params.modelOverride,
      projectId: project.id,
      recentFailures,
    })

    const runtimeSettings = runtimeSettingsWithApprovalMode(
      settings.agents.runtimes[decision.agentId],
      params.approvalMode,
      settings.execution.defaultApprovalMode,
    )

    return context.sessionManager.steer({
      sessionId: params.sessionId,
      projectId: session.projectId,
      prompt: params.prompt,
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
