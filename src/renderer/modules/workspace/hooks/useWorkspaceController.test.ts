import { describe, expect, it } from 'vitest'
import {
  buildSwarmWorkspaceState,
  nextScopedDiffProposalState,
  visibleDiffProposalsForActiveSession,
  type ScopedDiffProposalState,
} from './useWorkspaceController'

describe('buildSwarmWorkspaceState', () => {
  it('opens a swarm as one chat using the shared thread and visible session', () => {
    const state = buildSwarmWorkspaceState(
      {
        swarmId: '12345678-aaaa-bbbb-cccc-123456789abc',
        threadId: 'thread-1',
        sessions: [
          {
            sessionId: 'session-a',
            threadId: 'thread-1',
            role: 'planner',
            status: 'running',
            agentId: 'claude-code',
            model: 'claude-sonnet-4-6',
          },
          {
            sessionId: 'session-b',
            threadId: 'thread-1',
            role: 'reviewer',
            status: 'running',
            agentId: 'codex',
            model: 'gpt-5.3-codex',
          },
        ],
      },
      'project-1',
      1_000,
    )

    expect(state).toMatchObject({
      activeSession: {
        id: 'session-b',
        threadId: 'thread-1',
        prompt: 'Swarm 12345678 (2 agents)',
        status: 'running',
        agentId: 'codex',
        modelOverride: 'gpt-5.3-codex',
        createdAt: 1_000,
      },
      tab: {
        sessionId: 'session-b',
        projectId: 'project-1',
        prompt: 'Swarm 12345678 (2 agents)',
        status: 'running',
        model: 'codex / gpt-5.3-codex',
        tier: 'balanced',
        createdAt: 1_000,
      },
    })
  })

  it('falls back to running for unknown transient swarm statuses', () => {
    const state = buildSwarmWorkspaceState(
      {
        swarmId: 'swarm-1',
        threadId: 'thread-1',
        sessions: [
          {
            sessionId: 'session-a',
            threadId: 'thread-1',
            role: 'implementer',
            status: 'queued',
          },
        ],
      },
      'project-1',
      1_000,
    )

    expect(state?.activeSession.status).toBe('running')
    expect(state?.tab.status).toBe('running')
  })
})

describe('visibleDiffProposalsForActiveSession', () => {
  const state: ScopedDiffProposalState = {
    sessionId: 'session-1',
    threadId: 'thread-1',
    proposals: [
      {
        filePath: '/repo/current.ts',
        originalContent: 'old',
        proposedContent: 'new',
      },
    ],
  }

  it('returns proposals only for the active chat session', () => {
    expect(visibleDiffProposalsForActiveSession(state, 'session-1', 'thread-1')).toEqual(
      state.proposals,
    )
  })

  it('hides proposals captured from another thread or session in visible state', () => {
    expect(visibleDiffProposalsForActiveSession(state, 'session-2', 'thread-1')).toEqual([])
    expect(visibleDiffProposalsForActiveSession(state, 'session-1', 'thread-2')).toEqual([])
  })

  it('rejects proposals captured from another session in the active thread', () => {
    const next = nextScopedDiffProposalState(
      null,
      [
        {
          filePath: '/repo/swarm-agent.ts',
          originalContent: 'old',
          proposedContent: 'new',
        },
      ],
      { sessionId: 'implementer-session', threadId: 'thread-1' },
      'reviewer-session',
      'thread-1',
    )

    expect(visibleDiffProposalsForActiveSession(next, 'reviewer-session', 'thread-1')).toEqual([])
  })

  it('merges proposals from the active session instead of replacing earlier edits', () => {
    const current: ScopedDiffProposalState = {
      sessionId: 'session-1',
      threadId: 'thread-1',
      proposals: [
        {
          filePath: '/repo/first.ts',
          originalContent: 'old',
          proposedContent: 'new',
        },
      ],
    }

    expect(
      nextScopedDiffProposalState(
        current,
        [
          {
            filePath: '/repo/second.ts',
            originalContent: 'before',
            proposedContent: 'after',
          },
        ],
        { sessionId: 'session-1', threadId: 'thread-1' },
        'session-1',
        'thread-1',
      )?.proposals,
    ).toEqual([
      {
        filePath: '/repo/first.ts',
        originalContent: 'old',
        proposedContent: 'new',
      },
      {
        filePath: '/repo/second.ts',
        originalContent: 'before',
        proposedContent: 'after',
      },
    ])
  })

  // Regression: switching threads must not leak edited files from the
  // previous thread into the new one. The local proposals shadow in
  // RunWorkspace used to surface the prior thread's files in the new
  // thread's "Edited N files" trailing card while the agent was still
  // working ("Drafting"); the scoped store is what makes the leak
  // structurally impossible, so freeze the contract here.
  it('starts a new thread with no visible proposals even if the store still holds the previous thread', () => {
    const previousThreadState: ScopedDiffProposalState = {
      sessionId: 'session-prev',
      threadId: 'thread-prev',
      proposals: [
        {
          filePath: '/repo/cli-tools/CliToolsView.tsx',
          originalContent: 'old',
          proposedContent: 'new',
        },
        {
          filePath: '/repo/agents/registerAgentHandlers.ts',
          originalContent: 'old',
          proposedContent: 'new',
        },
      ],
    }

    expect(
      visibleDiffProposalsForActiveSession(
        previousThreadState,
        'session-new',
        'thread-new',
      ),
    ).toEqual([])
  })

  // Regression: a stale diff event firing after the user switches threads
  // (closure still tagged with the previous source) must not be merged
  // into the new thread's visible state. Without this guard the renderer
  // would render an "Edited N files" card for the previous thread inside
  // the new one — exactly the bug reported in the screenshot.
  it('rejects stale diff events tagged with the previous thread after a switch', () => {
    const previousThreadState: ScopedDiffProposalState = {
      sessionId: 'session-prev',
      threadId: 'thread-prev',
      proposals: [
        {
          filePath: '/repo/cli-tools/CliToolsView.tsx',
          originalContent: 'old',
          proposedContent: 'new',
        },
      ],
    }

    const afterStaleEvent = nextScopedDiffProposalState(
      previousThreadState,
      [
        {
          filePath: '/repo/cli-tools/CliToolsView.tsx',
          originalContent: 'old',
          proposedContent: 'newer',
        },
      ],
      // Source tag reflects the previous thread (callback closure was
      // captured before the user switched).
      { sessionId: 'session-prev', threadId: 'thread-prev' },
      // Active session/thread are the new ones.
      'session-new',
      'thread-new',
    )

    expect(
      visibleDiffProposalsForActiveSession(afterStaleEvent, 'session-new', 'thread-new'),
    ).toEqual([])
  })

  // Regression: when the user starts a new thread and the agent emits a
  // diff event for that new session, the visible proposals must contain
  // ONLY the new thread's files — never the previous thread's.
  it('only exposes the active thread\'s proposals once it has emitted its own diff', () => {
    const previousThreadState: ScopedDiffProposalState = {
      sessionId: 'session-prev',
      threadId: 'thread-prev',
      proposals: [
        {
          filePath: '/repo/cli-tools/CliToolsView.tsx',
          originalContent: 'old',
          proposedContent: 'new',
        },
      ],
    }

    const afterNewThreadDiff = nextScopedDiffProposalState(
      previousThreadState,
      [
        {
          filePath: '/repo/new-thread-edit.ts',
          originalContent: 'before',
          proposedContent: 'after',
        },
      ],
      { sessionId: 'session-new', threadId: 'thread-new' },
      'session-new',
      'thread-new',
    )

    expect(
      visibleDiffProposalsForActiveSession(afterNewThreadDiff, 'session-new', 'thread-new'),
    ).toEqual([
      {
        filePath: '/repo/new-thread-edit.ts',
        originalContent: 'before',
        proposedContent: 'after',
      },
    ])
  })
})
