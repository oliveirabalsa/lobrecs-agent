import { useEffect, useMemo, useState } from 'react'
import type { AgentActivity, AgentEvent } from '../../../../shared/types'
import { completionStatus, eventKey, textFromPayload } from '../../../components/TerminalPanel/events'

export function useSessionEvents(sessionId: string | null) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setEvents([])
    if (!sessionId) {
      setLoading(false)
      return
    }

    let cancelled = false
    const seen = new Set<string>()
    const append = (event: AgentEvent) => {
      const key = eventKey(event)
      if (seen.has(key)) return
      seen.add(key)
      setEvents((current) => [...current, event])
    }

    setLoading(true)
    const unsubscribe = window.agentforge.on(`session:${sessionId}`, append)

    void window.agentforge.sessions
      .listEvents(sessionId)
      .then((loadedEvents) => {
        if (cancelled) return
        loadedEvents.forEach(append)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [sessionId])

  const activities = useMemo(() => events.flatMap(activityFromEvent), [events])

  return { events, activities, loading }
}

function activityFromEvent(event: AgentEvent): AgentActivity[] {
  if (event.type === 'activity' && isAgentActivity(event.payload)) {
    return [event.payload]
  }

  if (event.type === 'stdout') {
    const text = textFromPayload(event.payload)
    return text.trim()
      ? [{ kind: 'message', role: 'assistant', text, stream: true }]
      : []
  }

  if (event.type === 'stderr') {
    const text = textFromPayload(event.payload)
    return text.trim()
      ? [{ kind: 'step', title: 'Process warning', detail: text.trim(), status: 'error' }]
      : []
  }

  if (event.type === 'approval-request') {
    return [{ kind: 'step', title: 'Approval requested', status: 'pending' }]
  }

  if (event.type === 'diff') {
    return [{ kind: 'step', title: 'Code changes ready for review', status: 'pending' }]
  }

  if (event.type === 'session-complete') {
    const status = completionStatus(event.payload)
    return [
      {
        kind: 'completion',
        status,
        summary: status === 'error' ? 'Session failed' : 'Session complete',
      },
    ]
  }

  if (event.type === 'error') {
    const text = textFromPayload(event.payload, { fallbackToJson: true })
    return [
      {
        kind: 'step',
        title: 'Session failed',
        detail: text.trim(),
        status: 'error',
      },
    ]
  }

  return []
}

function isAgentActivity(payload: unknown): payload is AgentActivity {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'kind' in payload &&
    typeof (payload as { kind?: unknown }).kind === 'string'
  )
}
