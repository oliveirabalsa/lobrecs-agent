import type { Automation, AutomationRunResult } from '../../shared/contracts/automations'
import type { IpcInvoker } from './ipc'

export interface AutomationsApi {
  list(projectId: string): Promise<Automation[]>
  create(data: Omit<Automation, 'id' | 'createdAt' | 'lastRunAt'>): Promise<Automation>
  update(id: string, data: Partial<Automation>): Promise<Automation>
  delete(id: string): Promise<void>
  runNow(id: string): Promise<AutomationRunResult>
}

export function createAutomationsApi(ipcRenderer: IpcInvoker): AutomationsApi {
  return {
    list: (projectId) => ipcRenderer.invoke('automations:list', projectId),
    create: (data) => ipcRenderer.invoke('automations:create', data),
    update: (id, data) => ipcRenderer.invoke('automations:update', id, data),
    delete: (id) => ipcRenderer.invoke('automations:delete', id),
    runNow: (id) => ipcRenderer.invoke('automations:run-now', id),
  }
}
