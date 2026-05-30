import { describe, expect, it, vi } from 'vitest'
import type { AgentId } from '../../../../shared/types'
import type { ActiveSession, PendingQueuedMessage } from './sessionWorkflowTypes'
import { SessionQueueService } from './sessionQueueService'

describe('SessionQueueService', () => {
  it('keeps a queued message when dispatching it fails', async () => {
    const activeSessions = new Map<string, ActiveSession>()
    const pendingQueues = new Map<string, PendingQueuedMessage[]>()
    const dispatch = vi.fn().mockRejectedValue(new Error('adapter unavailable'))
    const service = new SessionQueueService({ activeSessions, pendingQueues, dispatch })

    const queued = service.enqueueMessage(
      {
        prompt: 'retry this',
        agentId: 'codex' as AgentId,
        model: 'gpt-5.3-codex',
      },
      'thread-1',
    )

    await service.dispatchNextQueued('thread-1', {
      projectId: 'project-1',
      repoPath: '/repo',
    })

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(service.getQueue('thread-1')).toEqual([queued])
  })

  it('removes only the dispatched queued message after dispatch succeeds', async () => {
    const activeSessions = new Map<string, ActiveSession>()
    const pendingQueues = new Map<string, PendingQueuedMessage[]>()
    const dispatch = vi.fn().mockResolvedValue({ sessionId: 'session-1', threadId: 'thread-1' })
    const service = new SessionQueueService({ activeSessions, pendingQueues, dispatch })

    const first = service.enqueueMessage(
      {
        prompt: 'first',
        agentId: 'codex' as AgentId,
        model: 'gpt-5.3-codex',
      },
      'thread-1',
    )
    const second = service.enqueueMessage(
      {
        prompt: 'second',
        agentId: 'codex' as AgentId,
        model: 'gpt-5.3-codex',
      },
      'thread-1',
    )

    await service.dispatchNextQueued('thread-1', {
      projectId: 'project-1',
      repoPath: '/repo',
    })

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: first.prompt, threadId: 'thread-1' }),
    )
    expect(service.getQueue('thread-1')).toEqual([second])
  })
})
