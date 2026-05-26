import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  setDbForTests,
  closeDb,
  automationsStore,
  projectsStore,
  sessionsStore,
} from '../../../store'
import type { MainIpcContext } from '../../shared/ipcContext'
import { AutomationSchedulerService } from './automationSchedulerService'

describe('AutomationSchedulerService', () => {
  beforeEach(() => {
    setDbForTests(new Database(':memory:'))
  })

  afterEach(() => {
    closeDb()
  })

  it('creates schedule metadata and records a manual run lifecycle', async () => {
    const dispatch = vi.fn().mockImplementation((input) => {
      sessionsStore.create({
        id: 'session-1',
        projectId: input.projectId,
        agentId: input.agentId,
        model: input.model,
        prompt: input.prompt,
        spawnedAgent: input.spawnedAgent,
      })
      return Promise.resolve({ sessionId: 'session-1', threadId: 'thread-1' })
    })
    const service = new AutomationSchedulerService()
    service.configure({
      modelRouter: {
        route: vi.fn().mockResolvedValue({ agentId: 'claude-code', model: 'sonnet' }),
      },
      sessionManager: { dispatch },
    } as unknown as MainIpcContext)
    const project = projectsStore.create({
      name: 'Automation project',
      repoPath: '/repo/automation',
      agentId: 'claude-code',
      modelTier: 'balanced',
    })

    const automation = service.createAutomation({
      projectId: project.id,
      name: 'Daily review',
      prompt: 'review the repo',
      schedule: '0 9 * * *',
      agentId: 'claude-code',
      enabled: true,
    })

    expect(automation.nextRunAt).toEqual(expect.any(Number))
    expect(automation.status).toBe('scheduled')

    const result = await service.runNow(automation.id)
    expect(result).toEqual({ sessionId: 'session-1', runId: expect.any(String) })
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: project.id,
        prompt: '[Automation: Daily review]\nreview the repo',
        spawnedAgent: { kind: 'automation', role: 'Daily review' },
      }),
    )

    service.handleNotifierEvent({
      type: 'session.done',
      sessionId: 'session-1',
      projectId: project.id,
      threadId: 'thread-1',
      spawnedAgent: { kind: 'automation', role: 'Daily review' },
    })

    expect(automationsStore.getRun(result.runId)).toMatchObject({
      status: 'succeeded',
      unread: true,
      reviewState: 'unread',
    })
    expect(automationsStore.get(automation.id)).toMatchObject({
      status: 'scheduled',
      reviewState: 'unread',
      unreadRunCount: 1,
    })
  })
})
