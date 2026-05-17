import type { CostSummary, PeriodCostRow } from '../../shared/contracts/cost'
import type { IpcInvoker } from './ipc'

export interface CostApi {
  byProject(projectId: string): Promise<CostSummary>
  byPeriod(days: number): Promise<PeriodCostRow[]>
}

export function createCostApi(ipcRenderer: IpcInvoker): CostApi {
  return {
    byProject: (projectId) => ipcRenderer.invoke('cost:by-project', projectId),
    byPeriod: (days) => ipcRenderer.invoke('cost:by-period', days),
  }
}
