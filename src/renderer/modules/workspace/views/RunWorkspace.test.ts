import { describe, expect, it } from 'vitest'
import type { AgentActivity, DiffProposal, GitDiffReviewResult } from '../../../../shared/types'
import {
  getSessionDiffReviewState,
  sessionHasCodeChanges,
} from './RunWorkspace'

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
