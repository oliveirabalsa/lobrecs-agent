import { describe, expect, it, vi } from 'vitest'
import {
  createSessionCompletionWaiter,
  isTerminalStatus,
  normalizeCompletionStatus,
  type SessionStore,
} from './sessionCompletion'
import type { AgentEvent, SessionStatus } from '../../../shared/types'

describe('sessionCompletion', () => {
  describe('isTerminalStatus', () => {
    it('returns true for done, error, cancelled', () => {
      expect(isTerminalStatus('done')).toBe(true)
      expect(isTerminalStatus('error')).toBe(true)
      expect(isTerminalStatus('cancelled')).toBe(true)
    })

    it('returns false for running, awaiting-approval, awaiting-input', () => {
      expect(isTerminalStatus('running')).toBe(false)
      expect(isTerminalStatus('awaiting-approval')).toBe(false)
      expect(isTerminalStatus('awaiting-input')).toBe(false)
    })
  })

  describe('normalizeCompletionStatus', () => {
    it('returns valid session statuses unchanged', () => {
      expect(normalizeCompletionStatus('running')).toBe('running')
      expect(normalizeCompletionStatus('awaiting-approval')).toBe('awaiting-approval')
      expect(normalizeCompletionStatus('awaiting-input')).toBe('awaiting-input')
      expect(normalizeCompletionStatus('done')).toBe('done')
      expect(normalizeCompletionStatus('error')).toBe('error')
      expect(normalizeCompletionStatus('cancelled')).toBe('cancelled')
    })

    it('normalizes unknown statuses to running', () => {
      expect(normalizeCompletionStatus('unknown' as any)).toBe('running')
      expect(normalizeCompletionStatus('')).toBe('running')
    })
  })

  describe('createSessionCompletionWaiter', () => {
    it('returns a function', () => {
      const mockStore = {
        get: () => null,
        listEvents: () => [],
      }
      const waiter = createSessionCompletionWaiter(mockStore, () => Promise.resolve())
      expect(typeof waiter).toBe('function')
    })

    it('throws when session not found', async () => {
      const mockStore: SessionStore = {
        get: () => null,
        listEvents: () => [],
      }
      const delay = vi.fn(async (_ms: number): Promise<void> => undefined)
      const waiter = createSessionCompletionWaiter(mockStore, delay)
      await expect(waiter('nonexistent')).rejects.toThrow('Session not found')
    })

    it('resolves immediately for done status with terminal event', async () => {
      const events: AgentEvent[] = [{ type: 'session-complete', sessionId: 's1', payload: null, timestamp: 1 }]
      const mockStore: SessionStore = {
        get: () => ({ status: 'done' }),
        listEvents: () => events,
      }
      let delayCalled = false
      const delay = vi.fn(async (_ms: number): Promise<void> => {
        delayCalled = true
        return undefined
      })
      const waiter = createSessionCompletionWaiter(mockStore, delay)
      const result = await waiter('s1')
      expect(result.status).toBe('done')
      expect(delayCalled).toBe(false)
    })

    it('waits and polls until terminal status', async () => {
      const events: AgentEvent[] = [{ type: 'session-complete', sessionId: 's1', payload: null, timestamp: 1 }]
      let callCount = 0
      const mockStore: SessionStore = {
        get: () => {
          callCount++
          const status: SessionStatus = callCount >= 3 ? 'done' : 'running'
          return { status }
        },
        listEvents: () => events,
      }
      const delay = vi.fn(async (_ms: number): Promise<void> => undefined)
      const waiter = createSessionCompletionWaiter(mockStore, delay)
      const result = await waiter('s1')
      expect(result.status).toBe('done')
      expect(callCount).toBe(3)
      expect(delay).toHaveBeenCalledTimes(2)
    })

    it('returns awaiting-input status with output', async () => {
      const events: AgentEvent[] = [{ type: 'activity', sessionId: 's1', payload: { kind: 'message', role: 'assistant', text: 'hello' }, timestamp: 1 }]
      const mockStore: SessionStore = {
        get: () => ({ status: 'awaiting-input' }),
        listEvents: () => events,
      }
      const delay = vi.fn(async (_ms: number): Promise<void> => undefined)
      const waiter = createSessionCompletionWaiter(mockStore, delay)
      const result = await waiter('s1')
      expect(result.status).toBe('awaiting-input')
      expect(result.output).toBe('hello')
    })

    it('returns cancelled status with output', async () => {
      const events: AgentEvent[] = [{ type: 'activity', sessionId: 's1', payload: { kind: 'message', role: 'assistant', text: 'cancelled' }, timestamp: 1 }]
      const mockStore: SessionStore = {
        get: () => ({ status: 'cancelled' }),
        listEvents: () => events,
      }
      const delay = vi.fn(async (_ms: number): Promise<void> => undefined)
      const waiter = createSessionCompletionWaiter(mockStore, delay)
      const result = await waiter('s1')
      expect(result.status).toBe('cancelled')
      expect(result.output).toBe('cancelled')
    })
  })
})
