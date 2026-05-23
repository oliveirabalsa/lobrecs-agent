import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [] as Array<{ webContents: { send: () => void } }>,
  },
}))

vi.mock('../store', () => ({
  sessionsStore: { addEvent: vi.fn() },
}))

import {
  askStepApproval,
  cancelAllStepApprovals,
  hasPendingStepApprovals,
  submitStepApprovalDecision,
} from './stepApprovalPrompt'

afterEach(() => {
  cancelAllStepApprovals()
})

const BASE = {
  sessionId: 'sess-1',
  completedRole: 'planner',
  nextRole: 'implementer',
  nextAgentId: 'codex',
  nextModel: 'gpt-5.3-codex',
}

describe('submitStepApprovalDecision', () => {
  it('returns false for an unknown approvalId', () => {
    expect(
      submitStepApprovalDecision({
        approvalId: 'never-issued',
        sessionId: 'sess-1',
        decision: 'continue',
      }),
    ).toBe(false)
  })

  it('returns false for an empty approvalId', () => {
    expect(
      submitStepApprovalDecision({
        approvalId: '',
        sessionId: 'sess-1',
        decision: 'cancel',
      }),
    ).toBe(false)
  })
})

describe('askStepApproval', () => {
  it('resolves cancelled when cancelAllStepApprovals fires', async () => {
    const pending = askStepApproval({ ...BASE, timeoutMs: 60_000 })

    expect(hasPendingStepApprovals()).toBe(true)
    cancelAllStepApprovals()

    expect(await pending).toEqual({ outcome: 'cancelled' })
    expect(hasPendingStepApprovals()).toBe(false)
  })

  it('resolves timeout when the timeout fires before a decision arrives', async () => {
    vi.useFakeTimers()
    try {
      const pending = askStepApproval({ ...BASE, timeoutMs: 5_000 })

      vi.advanceTimersByTime(5_000)
      expect(await pending).toEqual({ outcome: 'timeout' })
      expect(hasPendingStepApprovals()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('only allows the first decision to settle a prompt', async () => {
    let resolvedFirst: unknown
    askStepApproval({ ...BASE, timeoutMs: 60_000 }).then((value) => {
      resolvedFirst = value
    })

    // Defer until the broadcast finishes registering the pending entry.
    await Promise.resolve()
    expect(hasPendingStepApprovals()).toBe(true)

    cancelAllStepApprovals()
    await Promise.resolve()

    expect(resolvedFirst).toEqual({ outcome: 'cancelled' })

    // A second decision for the same (now-settled) prompt is a no-op.
    expect(
      submitStepApprovalDecision({
        approvalId: 'irrelevant',
        sessionId: 'sess-1',
        decision: 'continue',
      }),
    ).toBe(false)
  })
})
