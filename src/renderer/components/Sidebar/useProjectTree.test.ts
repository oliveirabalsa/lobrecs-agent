import { describe, expect, it } from 'vitest'
import type { Session } from '../../../shared/types'
import {
  aggregateThreadSessionStatus,
  shouldShowThreadInSidebar,
  threadAgentSummaryFromSession,
} from './useProjectTree'

const baseSession = {
  id: 'session-1',
  projectId: 'project-1',
  threadId: 'thread-1',
  agentId: 'codex',
  model: 'gpt-5.3-codex',
  prompt: 'Implement the request',
  status: 'running',
  tokensIn: 0,
  tokensOut: 0,
  costUsd: 0,
  createdAt: 1_000,
} satisfies Session

describe('threadAgentSummaryFromSession', () => {
  it('shows sessions that were explicitly spawned as agents', () => {
    expect(
      threadAgentSummaryFromSession({
        ...baseSession,
        spawnedAgent: { kind: 'swarm', role: 'implementer' },
      }),
    ).toEqual({
      sessionId: 'session-1',
      role: 'implementer',
      agentId: 'codex',
      model: 'gpt-5.3-codex',
      status: 'running',
      createdAt: 1_000,
    })
  })

  it('does not treat normal user retries as subagents', () => {
    expect(
      threadAgentSummaryFromSession({
        ...baseSession,
        prompt: '[Role: agent 2]\nImplement the request with additions',
      }),
    ).toBeNull()
  })

  it('shows QA repair sessions when the main process marks them', () => {
    expect(
      threadAgentSummaryFromSession({
        ...baseSession,
        spawnedAgent: { kind: 'quality-repair', role: 'QA repair agent' },
      })?.role,
    ).toBe('QA repair agent')
  })
})

describe('shouldShowThreadInSidebar', () => {
  it('hides threads that only contain spawned background agents', () => {
    expect(
      shouldShowThreadInSidebar([
        {
          ...baseSession,
          spawnedAgent: { kind: 'delegation', role: 'multitask-decomposer' },
        },
      ]),
    ).toBe(false)
  })

  it('keeps parent threads visible even when the latest session is a background agent', () => {
    expect(
      shouldShowThreadInSidebar([
        baseSession,
        {
          ...baseSession,
          id: 'child-session',
          spawnedAgent: { kind: 'delegation', role: 'Research context' },
          createdAt: 2_000,
        },
      ]),
    ).toBe(true)
  })
})

describe('aggregateThreadSessionStatus', () => {
  it('marks the thread as running when a background agent is still active', () => {
    expect(
      aggregateThreadSessionStatus('done', [
        {
          sessionId: 'child-session',
          role: 'Visual Evidence Capture',
          agentId: 'codex',
          model: 'gpt-5.5',
          status: 'running',
          createdAt: 2_000,
        },
      ]),
    ).toBe('running')
  })

  it('prioritizes child sessions waiting on the user over a completed parent', () => {
    expect(
      aggregateThreadSessionStatus('done', [
        {
          sessionId: 'child-session',
          role: 'Automation Triage',
          agentId: 'codex',
          model: 'gpt-5.5',
          status: 'awaiting-input',
          createdAt: 2_000,
        },
      ]),
    ).toBe('awaiting-input')
  })

  it('falls back to the parent session status when no background agent is active', () => {
    expect(
      aggregateThreadSessionStatus('done', [
        {
          sessionId: 'child-session',
          role: 'Final Verification',
          agentId: 'claude-code',
          model: 'claude-opus-4-7',
          status: 'done',
          createdAt: 2_000,
        },
      ]),
    ).toBe('done')
  })
})
