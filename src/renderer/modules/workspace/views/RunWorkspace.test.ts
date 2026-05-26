import { describe, expect, it } from 'vitest'
import type { AgentActivity, DiffProposal, GitDiffReviewResult } from '../../../../shared/types'
import {
  getSessionDiffReviewState,
  getSessionChangedLineStats,
  sessionHasCodeChanges,
  isFinishedSessionStatus,
} from './runWorkspaceState'

describe('sessionHasCodeChanges', () => {
  it('returns false when a stopped session produced no file changes', () => {
    const activities: AgentActivity[] = [
      {
        kind: 'step',
        title: 'No code changes detected',
        detail: 'The run stopped before writing files.',
        status: 'done',
      },
      {
        kind: 'completion',
        status: 'cancelled',
        summary: 'Session cancelled',
      },
    ]

    expect(sessionHasCodeChanges(activities, [])).toBe(false)
  })

  it('returns true when the session emitted file-change activity', () => {
    const activities: AgentActivity[] = [
      {
        kind: 'file-change',
        filePath: '/repo/src/app.ts',
        changeType: 'modified',
        additions: 4,
        deletions: 1,
        status: 'applied',
      },
    ]

    expect(sessionHasCodeChanges(activities, [])).toBe(true)
  })

  it('returns true when live diff proposals exist even before timeline file events', () => {
    const proposals: DiffProposal[] = [
      {
        filePath: '/repo/src/app.ts',
        originalContent: 'old\n',
        proposedContent: 'new\n',
        additions: 1,
        deletions: 1,
      },
    ]

    expect(sessionHasCodeChanges([], proposals)).toBe(true)
  })
})

describe('getSessionChangedLineStats', () => {
  it('prefers final diff proposal totals over timeline file-change totals', () => {
    const activities: AgentActivity[] = [
      {
        kind: 'file-change',
        filePath: '/repo/src/app.ts',
        changeType: 'modified',
        additions: 10,
        deletions: 5,
        status: 'applied',
      },
    ]
    const proposals: DiffProposal[] = [
      {
        filePath: '/repo/src/app.ts',
        originalContent: 'old\n',
        proposedContent: 'new\n',
        additions: 2,
        deletions: 1,
      },
      {
        filePath: '/repo/src/settings.ts',
        originalContent: 'a\n',
        proposedContent: 'a\nb\n',
        additions: 1,
        deletions: 0,
      },
    ]

    expect(getSessionChangedLineStats(activities, proposals)).toEqual({
      filesChanged: 2,
      additions: 3,
      deletions: 1,
    })
  })

  it('aggregates file-change activities when no diff proposals are available', () => {
    const activities: AgentActivity[] = [
      {
        kind: 'file-change',
        filePath: '/repo/src/app.ts',
        changeType: 'modified',
        additions: 2,
        deletions: 0,
        status: 'applied',
      },
      {
        kind: 'file-change',
        filePath: '/repo/src/app.ts',
        changeType: 'modified',
        additions: 1,
        deletions: 1,
        status: 'applied',
      },
      {
        kind: 'file-change',
        filePath: '/repo/src/settings.ts',
        changeType: 'modified',
        additions: 4,
        deletions: 0,
        status: 'applied',
      },
    ]

    expect(getSessionChangedLineStats(activities, [])).toEqual({
      filesChanged: 2,
      additions: 7,
      deletions: 1,
    })
  })

  it('falls back to the latest diff summary when file rows have no stats', () => {
    const activities: AgentActivity[] = [
      {
        kind: 'diff-summary',
        filesChanged: 2,
        additions: 8,
        deletions: 3,
        summary: '2 files changed',
      },
      {
        kind: 'file-change',
        filePath: '/repo/src/app.ts',
        changeType: 'modified',
        status: 'applied',
      },
    ]

    expect(getSessionChangedLineStats(activities, [])).toEqual({
      filesChanged: 2,
      additions: 8,
      deletions: 3,
    })
  })
})

describe('getSessionDiffReviewState', () => {
  it('returns an empty state when the active session has no review yet', () => {
    expect(getSessionDiffReviewState({}, 'session-1')).toEqual({
      result: null,
      loading: false,
      error: null,
    })
  })

  it('keeps one session review state from leaking into another session', () => {
    const review: GitDiffReviewResult = {
      projectId: 'project-1',
      fingerprint: 'fingerprint-1',
      changedFiles: [
        {
          path: 'src/app.ts',
          status: 'modified',
        },
      ],
      summary: 'One finding',
      findings: [],
      branch: 'main',
      statusSummary: 'M src/app.ts',
      analysis: {
        agentId: 'codex',
        model: 'gpt-5.4',
      },
    }

    const state = {
      'session-1': {
        result: review,
        loading: false,
        error: null,
      },
      'session-2': {
        result: null,
        loading: true,
        error: null,
      },
    }

    expect(getSessionDiffReviewState(state, 'session-1')).toEqual({
      result: review,
      loading: false,
      error: null,
    })
    expect(getSessionDiffReviewState(state, 'session-2')).toEqual({
      result: null,
      loading: true,
      error: null,
    })
    expect(getSessionDiffReviewState(state, 'session-3')).toEqual({
      result: null,
      loading: false,
      error: null,
    })
  })
})

describe('isFinishedSessionStatus', () => {
  it('returns true for terminal statuses', () => {
    expect(isFinishedSessionStatus('done')).toBe(true)
    expect(isFinishedSessionStatus('error')).toBe(true)
    expect(isFinishedSessionStatus('cancelled')).toBe(true)
  })

  it('returns false for non-terminal statuses', () => {
    expect(isFinishedSessionStatus('running')).toBe(false)
    expect(isFinishedSessionStatus('awaiting-approval')).toBe(false)
    expect(isFinishedSessionStatus('awaiting-input')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isFinishedSessionStatus(null)).toBe(false)
  })
})
