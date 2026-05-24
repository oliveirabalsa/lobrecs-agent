import { Notification, type BrowserWindow } from 'electron'
import type {
  AppSettings,
  NotificationClickPayload,
  NotificationClickType,
  NotificationEventSettings,
} from '../../../shared/types'
import { NOTIFICATION_CLICK_CHANNEL } from '../../../shared/types'

export interface NotificationServiceDeps {
  getSettings: (projectId?: string) => AppSettings
  getMainWindow: () => BrowserWindow | null
  sendToRenderer: (channel: string, payload: unknown) => void
}

export interface NotificationDispatch {
  type: NotificationClickType
  title: string
  body: string
  click: NotificationClickPayload
}

const EVENT_KEY_BY_TYPE: Record<NotificationClickType, keyof NotificationEventSettings> = {
  'swarm.completed': 'swarmCompleted',
  'diff.ready': 'diffReady',
  'automation.success': 'automationSuccess',
  'automation.failure': 'automationFailure',
  'session.error': 'sessionError',
}

export class NotificationService {
  constructor(private readonly deps: NotificationServiceDeps) {}

  dispatch(input: NotificationDispatch): void {
    if (!Notification.isSupported()) return

    const settings = this.deps.getSettings(input.click.projectId).general
    if (!settings.enableDesktopNotifications) return
    if (!settings.notificationEvents[EVENT_KEY_BY_TYPE[input.type]]) return

    const window = this.deps.getMainWindow()
    if (settings.onlyWhenUnfocused && window?.isFocused()) return

    const notification = new Notification({
      title: input.title,
      body: input.body,
      silent: false,
    })

    notification.on('click', () => {
      const target = this.deps.getMainWindow()
      if (target) {
        if (target.isMinimized()) target.restore()
        target.show()
        target.focus()
      }
      this.deps.sendToRenderer(NOTIFICATION_CLICK_CHANNEL, input.click)
    })

    notification.show()
  }
}
