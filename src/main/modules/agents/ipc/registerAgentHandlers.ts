import { ipcMain } from 'electron'
import { modelTierFromModel } from '../../../router'
import { feedbackStore, projectsStore } from '../../../store'
import { requireProject } from '../../projects/application/requireProject'
import type { MainIpcContext } from '../../shared/ipcContext'
import { isSupportedAgentId } from '../domain/isSupportedAgentId'
import type { AgentId } from '../../../../shared/types'

export function registerAgentHandlers(context: MainIpcContext): void {
  ipcMain.handle(
    'agent:dispatch',
    async (
      _event,
      params: {
        projectId: string
        prompt: string
        agentId?: AgentId
        modelOverride?: string
      },
    ) => {
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
        modelOverride: params.modelOverride,
        recentFailures,
      })
      const sessionId = await context.sessionManager.dispatch({
        projectId: project.id,
        prompt: params.prompt,
        agentId: decision.agentId,
        model: decision.model,
        repoPath: project.repoPath,
        context: projectsStore.getContext(project.id),
      })

      return { sessionId }
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
}
