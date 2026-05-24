export type NotificationClickType =
  | 'swarm.completed'
  | 'diff.ready'
  | 'automation.success'
  | 'automation.failure'
  | 'session.error'

export interface NotificationClickPayload {
  type: NotificationClickType
  projectId: string
  threadId?: string
  sessionId?: string
}

export const NOTIFICATION_CLICK_CHANNEL = 'notification:click'
