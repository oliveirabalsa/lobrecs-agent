import { ipcMain } from 'electron'
import type { MainIpcContext } from '../../shared/ipcContext'
import type { CreateAutomationInput, UpdateAutomationInput } from '../../../store'
import { automationSchedulerService } from '../application/automationSchedulerService'

export function registerAutomationHandlers(context: MainIpcContext): void {
  automationSchedulerService.configure(context)

  ipcMain.handle('automations:list', async (_event, projectId: string) =>
    automationSchedulerService.list(projectId),
  )
  ipcMain.handle(
    'automations:create',
    async (_event, data: CreateAutomationInput) =>
      automationSchedulerService.createAutomation(data),
  )
  ipcMain.handle('automations:update', async (_event, id: string, data: UpdateAutomationInput) =>
    automationSchedulerService.updateAutomation(id, data),
  )
  ipcMain.handle('automations:delete', async (_event, id: string) => {
    automationSchedulerService.deleteAutomation(id)
  })
  ipcMain.handle('automations:run-now', async (_event, id: string) =>
    automationSchedulerService.runNow(id),
  )
  ipcMain.handle('automations:list-runs', async (_event, projectId: string) =>
    automationSchedulerService.listRuns(projectId),
  )
  ipcMain.handle('automations:acknowledge-run', async (_event, runId: string) =>
    automationSchedulerService.acknowledgeRun(runId),
  )
  ipcMain.handle('automations:review-run', async (_event, runId: string) =>
    automationSchedulerService.reviewRun(runId),
  )
  ipcMain.handle('automations:retry-run', async (_event, runId: string) =>
    automationSchedulerService.retryRun(runId),
  )
}
