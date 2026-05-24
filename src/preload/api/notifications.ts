import type { IpcRendererEvent } from 'electron'
import { NOTIFICATION_CLICK_CHANNEL, type NotificationClickPayload } from '../../shared/contracts'
import type { IpcSubscriber } from './ipc'

export interface NotificationsApi {
  onClick(callback: (payload: NotificationClickPayload) => void): () => void
}

export function createNotificationsApi(ipcRenderer: IpcSubscriber): NotificationsApi {
  return {
    onClick: (callback) => {
      const handler = (_event: IpcRendererEvent, payload: NotificationClickPayload) =>
        callback(payload)
      ipcRenderer.on(NOTIFICATION_CLICK_CHANNEL, handler)

      return () => ipcRenderer.removeListener(NOTIFICATION_CLICK_CHANNEL, handler)
    },
  }
}
