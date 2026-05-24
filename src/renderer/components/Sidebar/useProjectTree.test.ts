import { describe, expect, it } from 'vitest'
import type { Session } from '../../../shared/types'
import { threadAgentSummaryFromSession } from './useProjectTree'

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
