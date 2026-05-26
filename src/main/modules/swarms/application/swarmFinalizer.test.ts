import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Session } from '../../../../shared/types'
import { closeDb, setDbForTests } from '../../../store/db'
import { buildSwarmFinalizerPrompt, latestBackgroundSessionBlock } from './swarmFinalizer'

beforeEach(() => {
  setDbForTests(new Database(':memory:'))
})

afterEach(() => {
  closeDb()
})

describe('latestBackgroundSessionBlock', () => {
  it('selects the latest contiguous background-agent block', () => {
    const sessions: Session[] = [
      makeSession('parent-1', 1),
      makeSession('old-worker', 2, { kind: 'swarm', role: 'old' }),
      makeSession('finalizer-1', 3),
      makeSession('worker-1', 4, { kind: 'swarm', role: 'api' }),
      makeSession('worker-2', 5, { kind: 'swarm', role: 'ui' }),
      makeSession('finalizer-2', 6),
    ]

    expect(latestBackgroundSessionBlock(sessions).map((session) => session.id)).toEqual([
      'worker-1',
      'worker-2',
    ])
  })
})

describe('buildSwarmFinalizerPrompt', () => {
  it('instructs the main agent to summarize without spawning more background agents', () => {
    const prompt = buildSwarmFinalizerPrompt([
      makeSession('worker-1', 1, { kind: 'swarm', role: 'SessionManager Services' }),
    ])

    expect(prompt).toContain('[Background agent completion]')
    expect(prompt).toContain('Take the main-agent turn now')
    expect(prompt).toContain('Do not call DelegateTask')
    expect(prompt).toContain('SessionManager Services')
  })
})

function makeSession(
  id: string,
  createdAt: number,
  spawnedAgent?: Session['spawnedAgent'],
): Session {
  return {
    id,
    projectId: 'project-1',
    threadId: 'thread-1',
    agentId: 'codex',
    model: 'gpt-5.5',
    prompt: id,
    spawnedAgent,
    status: 'done',
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    createdAt,
    completedAt: createdAt + 1,
  }
}
