import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../../../shared/types'
import { diffProposalsFromThreadEvents } from './threadDiffProposals'

describe('diffProposalsFromThreadEvents', () => {
  it('collects diff proposals across every session in a shared swarm thread', () => {
    const firstProposal = makeProposal('/repo/src/a.ts', 'old a', 'new a')
    const secondProposal = makeProposal('/repo/src/b.ts', 'old b', 'new b')

    expect(
      diffProposalsFromThreadEvents([
        {
          sessionId: 'reviewer',
          createdAt: 20,
          events: [diffEvent('reviewer', [secondProposal], 22)],
        },
        {
          sessionId: 'implementer',
          createdAt: 10,
          events: [diffEvent('implementer', [firstProposal], 12)],
        },
      ]),
    ).toEqual([withDefaults(firstProposal), withDefaults(secondProposal)])
  })

  it('keeps the latest proposal for a file when later agents edit it again', () => {
    const firstAttempt = makeProposal('/repo/src/app.ts', 'old', 'attempt one')
    const secondAttempt = makeProposal('/repo/src/app.ts', 'attempt one', 'attempt two')

    expect(
      diffProposalsFromThreadEvents([
        {
          sessionId: 'implementer-1',
          createdAt: 10,
          events: [diffEvent('implementer-1', [firstAttempt], 12)],
        },
        {
          sessionId: 'implementer-2',
          createdAt: 20,
          events: [diffEvent('implementer-2', [secondAttempt], 22)],
        },
      ]),
    ).toEqual([
      {
        ...secondAttempt,
        changeType: 'modified',
        additions: 1,
        deletions: 1,
        status: 'pending',
      },
    ])
  })
})

function makeProposal(filePath: string, originalContent: string, proposedContent: string) {
  return {
    filePath,
    originalContent,
    proposedContent,
  }
}

type TestProposal = ReturnType<typeof makeProposal>

function withDefaults(proposal: TestProposal) {
  return {
    ...proposal,
    changeType: 'modified',
    additions: 1,
    deletions: 1,
    status: 'pending',
  }
}

function diffEvent(sessionId: string, proposals: unknown[], timestamp: number): AgentEvent {
  return {
    type: 'diff',
    sessionId,
    payload: proposals,
    timestamp,
  }
}
