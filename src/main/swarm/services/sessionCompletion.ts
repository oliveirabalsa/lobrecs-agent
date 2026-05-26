import type { AgentEvent, SessionStatus } from '../../../shared/types'
import { sessionsStore } from '../../store'
import { extractSessionOutput } from '../../store/sessionOutput'

export interface SwarmCompletionResult {
  status: SessionStatus
  output?: string
}

export interface SessionStore {
  get(id: string): { status: SessionStatus } | null
  listEvents(sessionId: string): AgentEvent[]
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createSessionCompletionWaiter(
  store?: SessionStore,
  delay: (ms: number) => Promise<void> = defaultDelay,
) {
  const sessionStore = store ?? sessionsStore
  return function waitForStoredSessionCompletion(sessionId: string): Promise<SwarmCompletionResult> {
    return waitForSessionCompletionImpl(sessionId, sessionStore, delay)
  }
}

async function waitForSessionCompletionImpl(
  sessionId: string,
  store: SessionStore,
  delay: (ms: number) => Promise<void>,
): Promise<SwarmCompletionResult> {
  for (;;) {
    const session = store.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const events = store.listEvents(sessionId)
    const terminalEvent = events.find(
      (event) => event.type === 'session-complete' || event.type === 'error',
    )

    if (session.status === 'awaiting-input') {
      return { status: 'awaiting-input', output: extractSessionOutput(events) }
    }

    if (session.status === 'cancelled') {
      return { status: 'cancelled', output: extractSessionOutput(events) }
    }

    if (terminalEvent && isTerminalStatus(session.status)) {
      return { status: session.status, output: extractSessionOutput(events) }
    }

    await delay(750)
  }
}

export function isTerminalStatus(status: SessionStatus | string): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

export function normalizeCompletionStatus(status: SessionStatus | string): SessionStatus {
  if (
    status === 'running' ||
    status === 'awaiting-approval' ||
    status === 'awaiting-input' ||
    status === 'done' ||
    status === 'error' ||
    status === 'cancelled'
  ) {
    return status
  }

  return 'running'
}
