import type { CreateSpecInput, Spec, UpdateSpecInput } from '../../shared/contracts/specs'
import type { IpcInvoker } from './ipc'

export interface SpecsApi {
  list(projectId: string): Promise<Spec[]>
  get(specId: string): Promise<Spec | null>
  create(data: CreateSpecInput): Promise<Spec>
  update(specId: string, data: UpdateSpecInput): Promise<Spec>
  approve(specId: string): Promise<Spec>
}

export function createSpecsApi(ipcRenderer: IpcInvoker): SpecsApi {
  return {
    list: (projectId) => ipcRenderer.invoke('specs:list', projectId),
    get: (specId) => ipcRenderer.invoke('specs:get', specId),
    create: (data) => ipcRenderer.invoke('specs:create', data),
    update: (specId, data) => ipcRenderer.invoke('specs:update', specId, data),
    approve: (specId) => ipcRenderer.invoke('specs:approve', specId),
  }
}
