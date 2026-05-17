import type { RoutingDecision } from '../../shared/contracts/routing'
import type { IpcInvoker } from './ipc'

export interface RouterApi {
  preview(prompt: string, projectId: string): Promise<RoutingDecision>
}

export function createRouterApi(ipcRenderer: IpcInvoker): RouterApi {
  return {
    preview: (prompt, projectId) => ipcRenderer.invoke('router:preview', prompt, projectId),
  }
}
