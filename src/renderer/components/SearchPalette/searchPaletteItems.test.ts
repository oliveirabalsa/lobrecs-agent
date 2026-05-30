import { describe, expect, it } from 'vitest'
import type { ThreadSearchResult } from '../../../shared/types'
import { buildSearchPaletteItems, type SearchPaletteCommand } from './searchPaletteItems'

describe('buildSearchPaletteItems', () => {
  const commands: SearchPaletteCommand[] = [
    {
      id: 'new-chat',
      label: 'New Chat',
      description: 'Start a fresh thread',
      keywords: ['thread', 'compose'],
    },
    {
      id: 'extensions',
      label: 'Extensions',
      description: 'Install plugins and skills',
      keywords: ['marketplace'],
    },
  ]
  const threadResult = {
    project: {
      id: 'project-1',
      name: 'lobrecs-agent',
      repoPath: '/repo',
      agentId: 'codex',
      modelTier: 'balanced',
      createdAt: 1,
      updatedAt: 1,
    },
    thread: {
      id: 'thread-1',
      title: 'Fix marketplace',
      projectId: 'project-1',
      lastSessionId: 'session-1',
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
    },
    sessionId: 'session-1',
    matchKind: 'thread',
    matchText: 'Fix marketplace',
    updatedAt: 1,
  } satisfies ThreadSearchResult

  it('shows commands before thread results for an empty query', () => {
    const items = buildSearchPaletteItems({
      query: '',
      commands,
      threadResults: [threadResult],
    })

    expect(items.map((item) => item.kind)).toEqual(['command', 'command', 'thread'])
  })

  it('filters commands by label, description, and keywords without dropping thread results', () => {
    const items = buildSearchPaletteItems({
      query: 'marketplace',
      commands,
      threadResults: [threadResult],
    })

    expect(items[0]).toMatchObject({
      kind: 'command',
      command: { id: 'extensions' },
    })
    expect(items.at(-1)).toMatchObject({
      kind: 'thread',
      result: { thread: { id: 'thread-1' } },
    })
  })
})
