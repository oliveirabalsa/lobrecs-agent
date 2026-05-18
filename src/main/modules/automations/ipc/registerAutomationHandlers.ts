import { ipcMain } from 'electron'
import { automationsStore, projectsStore } from '../../../store'
import { requireProject } from '../../projects/application/requireProject'
import type { MainIpcContext } from '../../shared/ipcContext'
import type { Automation } from '../../../../shared/types'

export function registerAutomationHandlers(context: MainIpcContext): void {
  ipcMain.handle('automations:list', async (_event, projectId: string) =>
    automationsStore.list(projectId),
  )
  ipcMain.handle(
    'automations:create',
    async (_event, data: Omit<Automation, 'id' | 'createdAt' | 'lastRunAt'>) =>
      automationsStore.create(data),
  )
  ipcMain.handle('automations:update', async (_event, id: string, data: Partial<Automation>) =>
    automationsStore.update(id, data),
  )
  ipcMain.handle('automations:delete', async (_event, id: string) => {
    automationsStore.delete(id)
  })
  ipcMain.handle('automations:run-now', async (_event, id: string) => {
    const automation = automationsStore.get(id)
    if (!automation) throw new Error('Automation not found')

    const project = requireProject(automation.projectId)
    const decision = await context.modelRouter.route({
      prompt: automation.prompt,
      preferredAgentId: automation.agentId,
    })
    const { sessionId } = await context.sessionManager.dispatch({
      projectId: project.id,
      prompt: `[Automation: ${automation.name}]\n${automation.prompt}`,
      agentId: decision.agentId,
      model: decision.model,
      repoPath: project.repoPath,
      context: projectsStore.getContext(project.id),
    })

    automationsStore.markRun(id)
    return { sessionId }
  })
}
