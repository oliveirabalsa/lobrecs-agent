import { ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { modelTierFromModel } from '../../../router'
import { feedbackStore, projectsStore } from '../../../store'
import { submitPlanDecision } from '../../../swarm/planPrompt'
import { requireProject } from '../../projects/application/requireProject'
import type { MainIpcContext } from '../../shared/ipcContext'
import { isSupportedAgentId } from '../domain/isSupportedAgentId'
import type {
  AgentDispatchParams,
  AgentId,
  AgentPlanDecisionPayload,
  ImageAttachment,
} from '../../../../shared/types'
const MAX_IMAGE_ATTACHMENTS = 8
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

function isImageSupported(agentId: AgentId): boolean {
  return agentId === 'claude-code' || agentId === 'codex'
}

async function normalizeImageAttachments(
  images: ImageAttachment[] | undefined,
): Promise<ImageAttachment[]> {
  const normalized: ImageAttachment[] = []
  const seen = new Set<string>()

  for (const image of images ?? []) {
    if (!image?.filePath || typeof image.filePath !== 'string') continue
    const filePath = path.resolve(image.filePath)
    const key = `${filePath}:${image.name ?? ''}:${image.size ?? ''}`

    if (seen.has(key)) continue

    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) continue

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

    if (normalized.length >= MAX_IMAGE_ATTACHMENTS) break
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
      const imageAttachments = await normalizeImageAttachments(params.imageAttachments)
      const project = requireProject(params.projectId)
      const preferredAgentId = isSupportedAgentId(params.agentId)
        ? params.agentId
        : project.agentId
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
        recentFailures,
      })

      if (imageAttachments.length > 0 && !isImageSupported(decision.agentId)) {
        throw new Error('Image attachments are only supported by Claude Code and OpenAI Codex')
      }

      const { sessionId, threadId } = await context.sessionManager.dispatch({
        projectId: project.id,
        prompt: params.prompt,
        agentId: decision.agentId,
        model: decision.model,
        repoPath: project.repoPath,
        imageAttachments,
        context: projectsStore.getContext(project.id),
        threadId: params.threadId,
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
}
