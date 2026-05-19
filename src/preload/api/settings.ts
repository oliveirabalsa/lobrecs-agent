import type { IpcRendererEvent } from 'electron'
import type {
  AppSettings,
  AppSettingsPatch,
  EffectiveAppSettings,
  ProjectSettingsOverrides,
  SettingsUpdateEvent,
} from '../../shared/types'
import type { IpcInvoker, IpcSubscriber } from './ipc'

export interface SettingsApi {
  getGlobal(): Promise<AppSettings>
  updateGlobal(input: AppSettingsPatch): Promise<AppSettings>
  getEffective(projectId?: string): Promise<EffectiveAppSettings>
  getProjectOverrides(projectId: string): Promise<ProjectSettingsOverrides | null>
  updateProjectOverrides(
    projectId: string,
    input: AppSettingsPatch,
  ): Promise<ProjectSettingsOverrides>
  resetProjectOverrides(projectId: string): Promise<void>
  onUpdated(callback: (event: SettingsUpdateEvent) => void): () => void
}

export function createSettingsApi(ipcRenderer: IpcInvoker & IpcSubscriber): SettingsApi {
  return {
    getGlobal: () => ipcRenderer.invoke('settings:get-global'),
    updateGlobal: (input) => ipcRenderer.invoke('settings:update-global', input),
    getEffective: (projectId) => ipcRenderer.invoke('settings:get-effective', projectId),
    getProjectOverrides: (projectId) =>
      ipcRenderer.invoke('settings:get-project-overrides', projectId),
    updateProjectOverrides: (projectId, input) =>
      ipcRenderer.invoke('settings:update-project-overrides', projectId, input),
    resetProjectOverrides: (projectId) =>
      ipcRenderer.invoke('settings:reset-project-overrides', projectId),
    onUpdated: (callback) => {
      const handler = (_event: IpcRendererEvent, payload: SettingsUpdateEvent) =>
        callback(payload)
      ipcRenderer.on('settings:updated', handler)
      return () => ipcRenderer.removeListener('settings:updated', handler)
    },
  }
}
