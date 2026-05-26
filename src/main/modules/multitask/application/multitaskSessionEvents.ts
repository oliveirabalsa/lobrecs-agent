import type { AgentEvent } from '../../../../shared/types'
import { sessionsStore } from '../../../store/sessions'

export type MultitaskSessionEventBroadcaster = (event: AgentEvent) => void

export function recordMultitaskSessionEvent(
  event: AgentEvent,
  broadcast: MultitaskSessionEventBroadcaster = () => undefined,
): void {
  sessionsStore.addEvent(event)
  broadcast(event)
}

export function finishMultitaskPlanningSession(
  sessionId: string,
  status: 'done' | 'cancelled',
  broadcast: MultitaskSessionEventBroadcaster = () => undefined,
): void {
  sessionsStore.updateStatus(sessionId, status)
  recordMultitaskSessionEvent(
    {
      type: 'session-complete',
      sessionId,
      payload: { status },
      timestamp: Date.now(),
    },
    broadcast,
  )
}
