import type {
  CostSummary,
  PeriodCostRow,
  ProviderUsageSummary,
} from '../../shared/contracts/cost'
import type { IpcInvoker } from './ipc'

export interface CostApi {
  byProject(projectId: string): Promise<CostSummary>
  byPeriod(days: number): Promise<PeriodCostRow[]>
  providerUsage(): Promise<ProviderUsageSummary>
}

export function createCostApi(ipcRenderer: IpcInvoker): CostApi {
  return {
    byProject: (projectId) => ipcRenderer.invoke('cost:by-project', projectId),
    byPeriod: (days) => ipcRenderer.invoke('cost:by-period', days),
    providerUsage: () => ipcRenderer.invoke('cost:provider-usage'),
  }
}
