import type { IpcRendererEvent } from 'electron'
import {
  APP_UPDATE_STATUS_CHANNEL,
  type AppUpdateState,
} from '../../shared/contracts/updates'
import type { IpcInvoker, IpcSubscriber } from './ipc'

export interface UpdatesApi {
  getState(): Promise<AppUpdateState>
  check(): Promise<AppUpdateState>
  download(): Promise<AppUpdateState>
  installAndRestart(): Promise<void>
  openReleaseUrl(): Promise<void>
  onStatus(callback: (state: AppUpdateState) => void): () => void
}

export function createUpdatesApi(ipcRenderer: IpcInvoker & IpcSubscriber): UpdatesApi {
  return {
    getState: () => ipcRenderer.invoke('updates:get-state'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    installAndRestart: () => ipcRenderer.invoke('updates:install-and-restart'),
    openReleaseUrl: () => ipcRenderer.invoke('updates:open-release-url'),
    onStatus: (callback) => {
      const handler = (_event: IpcRendererEvent, payload: AppUpdateState) => callback(payload)
      ipcRenderer.on(APP_UPDATE_STATUS_CHANNEL, handler)
      return () => ipcRenderer.removeListener(APP_UPDATE_STATUS_CHANNEL, handler)
    },
  }
}
