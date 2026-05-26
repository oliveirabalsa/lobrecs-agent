import type {
  CreateSpecInput,
  Spec,
  SpecArtifact,
  UpdateSpecInput,
  WriteSpecArtifactInput,
} from '../../shared/contracts/specs'
import { validateWriteSpecArtifactInput } from '../../shared/contracts/specs'
import type { IpcInvoker } from './ipc'

export interface SpecsApi {
  list(projectId: string): Promise<Spec[]>
  get(specId: string): Promise<Spec | null>
  create(data: CreateSpecInput): Promise<Spec>
  update(specId: string, data: UpdateSpecInput): Promise<Spec>
  approve(specId: string): Promise<Spec>
  listArtifacts(specId: string): Promise<SpecArtifact[]>
  readArtifact(specId: string, artifactId: string): Promise<SpecArtifact>
  writeArtifact(input: WriteSpecArtifactInput): Promise<SpecArtifact>
  suggestDraft(
    projectId: string,
    title: string,
    goal: string,
  ): Promise<{
    constraints: string
    requirements: string[]
    acceptanceCriteria: string[]
    targetFiles: string[]
  }>
}

export function createSpecsApi(ipcRenderer: IpcInvoker): SpecsApi {
  return {
    list: (projectId) => ipcRenderer.invoke('specs:list', projectId),
    get: (specId) => ipcRenderer.invoke('specs:get', specId),
    create: (data) => ipcRenderer.invoke('specs:create', data),
    update: (specId, data) => ipcRenderer.invoke('specs:update', specId, data),
    approve: (specId) => ipcRenderer.invoke('specs:approve', specId),
    listArtifacts: (specId) => ipcRenderer.invoke('specs:list-artifacts', specId),
    readArtifact: (specId, artifactId) =>
      ipcRenderer.invoke('specs:read-artifact', { specId, artifactId }),
    writeArtifact: (input) =>
      ipcRenderer.invoke('specs:write-artifact', validateWriteSpecArtifactInput(input)),
    suggestDraft: (projectId, title, goal) =>
      ipcRenderer.invoke('specs:draft-suggest', { projectId, title, goal }),
  }
}
