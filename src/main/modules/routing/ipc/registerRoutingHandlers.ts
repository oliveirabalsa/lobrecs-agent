import { ipcMain } from 'electron'
import { modelTierFromModel } from '../../../router'
import { feedbackStore, projectsStore } from '../../../store'
import type { MainIpcContext } from '../../shared/ipcContext'

export function registerRoutingHandlers(context: MainIpcContext): void {
  ipcMain.handle('router:preview', async (_event, prompt: string, projectId: string) => {
    const project = projectsStore.get(projectId)
    const recentFailures = project
      ? feedbackStore.getRecentFailures(project.id).map((failure) => ({
          prompt: failure.prompt,
          tier: modelTierFromModel(failure.model),
          failed: true,
        }))
      : []

    return context.modelRouter.route({
      prompt,
      preferredAgentId: project?.agentId,
      recentFailures,
    })
  })
}
