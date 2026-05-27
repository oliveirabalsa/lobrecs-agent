import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  CODEX_PLAN_MODE_MAX_STALL_MS,
  maxStallMsForSession,
  shouldTriggerLiveLocalDiff,
  SessionLivenessService,
} from './sessionLivenessService'
import { buildLocalDiffProposals } from '../../../session/localDiff'
import type { ActiveSession } from './sessionWorkflowTypes'
import type { AgentEvent } from '../../../../shared/types'

vi.mock('../../../session/localDiff', () => ({
  buildLocalDiffProposals: vi.fn(),
  captureLocalChangeBaseline: vi.fn(),
}))

describe('maxStallMsForSession', () => {
  it('extends the stall window for silent Codex plan-mode planning turns', () => {
    expect(maxStallMsForSession({ agentId: 'codex', planMode: true }, 300_000)).toBe(
      CODEX_PLAN_MODE_MAX_STALL_MS,
    )
  })

  it('keeps normal sessions on the configured stall window', () => {
    expect(maxStallMsForSession({ agentId: 'codex', planMode: false }, 300_000)).toBe(300_000)
    expect(maxStallMsForSession({ agentId: 'claude-code', planMode: true }, 300_000)).toBe(
      300_000,
    )
  })

  it('preserves disabled stall detection', () => {
    expect(maxStallMsForSession({ agentId: 'codex', planMode: true }, false)).toBe(false)
  })
})

describe('shouldTriggerLiveLocalDiff', () => {
  it('triggers for file-change activities', () => {
    const event: AgentEvent = {
      type: 'activity',
      sessionId: 's1',
      timestamp: Date.now(),
      payload: { kind: 'file-change', filePath: 'src/main.ts', changeType: 'modified', status: 'pending' },
    }
    expect(shouldTriggerLiveLocalDiff(event)).toBe(true)
  })

  it('triggers for tool-result activities', () => {
    const event: AgentEvent = {
      type: 'activity',
      sessionId: 's1',
      timestamp: Date.now(),
      payload: { kind: 'tool-result', name: 'read', status: 'done', output: 'content' },
    }
    expect(shouldTriggerLiveLocalDiff(event)).toBe(true)
  })

  it('triggers for completed command activities', () => {
    const eventDone: AgentEvent = {
      type: 'activity',
      sessionId: 's1',
      timestamp: Date.now(),
      payload: { kind: 'command', command: 'npm run test', status: 'done' },
    }
    const eventError: AgentEvent = {
      type: 'activity',
      sessionId: 's1',
      timestamp: Date.now(),
      payload: { kind: 'command', command: 'npm run test', status: 'error' },
    }
    expect(shouldTriggerLiveLocalDiff(eventDone)).toBe(true)
    expect(shouldTriggerLiveLocalDiff(eventError)).toBe(true)
  })

  it('does not trigger for running command activities', () => {
    const event: AgentEvent = {
      type: 'activity',
      sessionId: 's1',
      timestamp: Date.now(),
      payload: { kind: 'command', command: 'npm run test', status: 'running' },
    }
    expect(shouldTriggerLiveLocalDiff(event)).toBe(false)
  })

  it('does not trigger for running tool-call activities', () => {
    const event: AgentEvent = {
      type: 'activity',
      sessionId: 's1',
      timestamp: Date.now(),
      payload: { kind: 'tool-call', name: 'read', status: 'running' },
    }
    expect(shouldTriggerLiveLocalDiff(event)).toBe(false)
  })

  it('triggers for completed tool-call activities', () => {
    const event: AgentEvent = {
      type: 'activity',
      sessionId: 's1',
      timestamp: Date.now(),
      payload: { kind: 'tool-call', name: 'read', status: 'done' },
    }
    expect(shouldTriggerLiveLocalDiff(event)).toBe(true)
  })

  it('does not trigger for other activity kinds', () => {
    const event: AgentEvent = {
      type: 'activity',
      sessionId: 's1',
      timestamp: Date.now(),
      payload: { kind: 'step', title: 'Running agent', status: 'running' },
    }
    expect(shouldTriggerLiveLocalDiff(event)).toBe(false)
  })
})

describe('emitLiveLocalDiff in-flight guard', () => {
  let activeSessions: Map<string, ActiveSession>
  let mockHandleAgentEvent: any
  let service: SessionLivenessService

  beforeEach(() => {
    vi.clearAllMocks()
    activeSessions = new Map()
    mockHandleAgentEvent = vi.fn()
    service = new SessionLivenessService({
      activeSessions,
      idleHeartbeatMs: false,
      maxStallMs: false,
      recordEvent: vi.fn(),
      cancel: vi.fn(),
      handleAgentEvent: mockHandleAgentEvent,
      filterLocalDiffProposals: (_session, proposals) => [...proposals],
    })
  })

  it('prevents overlapping runs of buildLocalDiffProposals', async () => {
    const active: ActiveSession = {
      approve: vi.fn(),
      reject: vi.fn(),
      cancel: vi.fn(),
      repoPath: '/repo',
      threadId: 't1',
      worktreePath: null,
      persistentWorktree: false,
      localBaseline: { files: new Map() },
      localTouchedFiles: new Set(),
      sharedLocalRepo: false,
      lastAgentEventAt: Date.now(),
      lastIdleHeartbeatAt: Date.now(),
      qualityAttempt: 1,
      planMode: false,
      isolate: false,
      prompt: 'hello',
      agentId: 'claude-code',
      modelFallbacks: [],
      modelRecoveryMode: 'auto',
    }
    activeSessions.set('session-1', active)

    // Set up buildLocalDiffProposals mock to resolve with a delay
    let resolveDiff: any
    const diffPromise = new Promise<any>((resolve) => {
      resolveDiff = resolve
    })
    vi.mocked(buildLocalDiffProposals).mockReturnValue(diffPromise)

    // First call triggers diff generation
    const firstCall = service.emitLiveLocalDiff('session-1')

    // Expect buildLocalDiffProposals to have been called once, and liveDiffInProgress to be true
    expect(buildLocalDiffProposals).toHaveBeenCalledTimes(1)
    expect(active.liveDiffInProgress).toBe(true)

    // Second call while first is in-flight should return immediately without calling buildLocalDiffProposals again
    await service.emitLiveLocalDiff('session-1')
    expect(buildLocalDiffProposals).toHaveBeenCalledTimes(1)

    // Resolve the promise
    resolveDiff([
      {
        filePath: 'src/main.ts',
        originalContent: 'old',
        proposedContent: 'new',
        changeType: 'modified',
      },
    ])
    await firstCall

    // After resolution, liveDiffInProgress should be reset to false and handleAgentEvent should be called
    expect(active.liveDiffInProgress).toBe(false)
    expect(mockHandleAgentEvent).toHaveBeenCalledTimes(1)
  })
})
