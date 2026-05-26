import type {
  Automation,
  CreateAutomationInput,
  UpdateAutomationInput,
  AutomationRun,
  AutomationRunResult,
} from '../../shared/contracts/automations'
import type { IpcInvoker } from './ipc'

export interface AutomationsApi {
  list(projectId: string): Promise<Automation[]>
  create(data: CreateAutomationInput): Promise<Automation>
  update(id: string, data: UpdateAutomationInput): Promise<Automation>
  delete(id: string): Promise<void>
  runNow(id: string): Promise<AutomationRunResult>
  listRuns(projectId: string): Promise<AutomationRun[]>
  acknowledgeRun(runId: string): Promise<AutomationRun>
  reviewRun(runId: string): Promise<AutomationRun>
  retryRun(runId: string): Promise<AutomationRunResult>
}

export function createAutomationsApi(ipcRenderer: IpcInvoker): AutomationsApi {
  return {
    list: (projectId) => ipcRenderer.invoke('automations:list', projectId),
    create: (data) => ipcRenderer.invoke('automations:create', data),
    update: (id, data) => ipcRenderer.invoke('automations:update', id, data),
    delete: (id) => ipcRenderer.invoke('automations:delete', id),
    runNow: (id) => ipcRenderer.invoke('automations:run-now', id),
    listRuns: (projectId) => ipcRenderer.invoke('automations:list-runs', projectId),
    acknowledgeRun: (runId) => ipcRenderer.invoke('automations:acknowledge-run', runId),
    reviewRun: (runId) => ipcRenderer.invoke('automations:review-run', runId),
    retryRun: (runId) => ipcRenderer.invoke('automations:retry-run', runId),
  }
}
