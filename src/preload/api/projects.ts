import {
  validateCreateProjectInput,
  validateProjectId,
  validateUpdateProjectInput,
  type Project,
} from '../../shared/contracts/projects'
import type { IpcInvoker } from './ipc'

export interface ProjectsApi {
  list(): Promise<Project[]>
  create(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project>
  update(id: string, data: Partial<Project>): Promise<Project>
  delete(id: string): Promise<void>
}

export function createProjectsApi(ipcRenderer: IpcInvoker): ProjectsApi {
  return {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (data) => ipcRenderer.invoke('projects:create', validateCreateProjectInput(data)),
    update: (id, data) =>
      ipcRenderer.invoke('projects:update', validateProjectId(id), validateUpdateProjectInput(data)),
    delete: (id) => ipcRenderer.invoke('projects:delete', validateProjectId(id)),
  }
}
