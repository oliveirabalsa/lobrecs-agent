import { describe, expect, it } from 'vitest'
import type { StreamItem } from '../lib/groupTurns'
import {
  editedFileCards,
  editedFileCardsForFallbackFiles,
  flattenCodeChangeFallbacks,
  shouldPinMessageStream,
  splitFinalAssistant,
  streamItemReceivesRunningState,
  visibleProposalsForFallbackFiles,
} from './MessageStream'

describe('shouldPinMessageStream', () => {
  it('does not force pinning while a run is active when the user has scrolled up', () => {
    expect(
      shouldPinMessageStream({ loading: false, running: true, sticky: false }),
    ).toBe(false)
  })

  it('does not force pinning during initial load when the user has scrolled up', () => {
    expect(
      shouldPinMessageStream({ loading: true, running: false, sticky: false }),
    ).toBe(false)
  })

  it('pins only when the user is already at the bottom (sticky=true)', () => {
    expect(
      shouldPinMessageStream({ loading: false, running: false, sticky: false }),
    ).toBe(false)
    expect(
      shouldPinMessageStream({ loading: false, running: false, sticky: true }),
    ).toBe(true)
    expect(
      shouldPinMessageStream({ loading: true, running: true, sticky: true }),
    ).toBe(true)
  })
})

describe('splitFinalAssistant', () => {
  it('keeps assistant output in the renderable stream while a turn is running', () => {
    const items: StreamItem[] = [
      { kind: 'message', role: 'assistant', text: 'partial answer' },
      { kind: 'tool-call', name: 'bash', status: 'running' },
      { kind: 'message', role: 'assistant', text: 'still streaming' },
    ]

    const result = splitFinalAssistant(items, { separateFinalAssistant: false })

    expect(result.finalAssistantText).toBeUndefined()
    expect(result.renderable).toEqual(items)
  })

  it('moves running code changes into the trailing edited-files card path', () => {
    const codeChange = {
      kind: 'file-change',
      filePath: 'src/app.ts',
      changeType: 'modified',
      additions: 3,
      deletions: 0,
      status: 'pending',
    } satisfies Extract<StreamItem, { kind: 'file-change' }>
    const items: StreamItem[] = [
      { kind: 'message', role: 'assistant', text: 'editing' },
      codeChange,
      { kind: 'message', role: 'assistant', text: 'still editing' },
    ]

    const result = splitFinalAssistant(items, { separateFinalAssistant: false })

    expect(result.renderable).toEqual([
      { kind: 'message', role: 'assistant', text: 'editing' },
      { kind: 'message', role: 'assistant', text: 'still editing' },
    ])
    expect(result.trailingCodeChanges).toEqual([codeChange])
  })

  it('moves the final assistant message after completed-turn artifacts', () => {
    const items: StreamItem[] = [
      { kind: 'message', role: 'assistant', text: 'final answer' },
      { kind: 'completion', status: 'done', summary: 'Session complete' },
      {
        kind: 'file-change',
        filePath: 'src/example.ts',
        changeType: 'modified',
        status: 'pending',
      },
    ]

    const result = splitFinalAssistant(items)

    expect(result.finalAssistantText).toBe('final answer')
    expect(result.renderable).toEqual([])
    expect(result.trailingCodeChanges.map((item) => item.kind)).toEqual(['file-change'])
  })

  it('keeps code changes after the final answer and before completion metrics', () => {
    const items: StreamItem[] = [
      { kind: 'message', role: 'assistant', text: 'summary' },
      {
        kind: 'file-change',
        filePath: 'src/example.ts',
        changeType: 'modified',
        status: 'pending',
      },
      { kind: 'completion', status: 'done', summary: 'Session complete' },
    ]

    const result = splitFinalAssistant(items)

    expect(result.finalAssistantText).toBe('summary')
    expect(result.renderable).toEqual([])
    expect(result.trailingCodeChanges).toHaveLength(1)
  })

  it('extracts plan-review markers so they render below the final plan', () => {
    const items: StreamItem[] = [
      { kind: 'message', role: 'assistant', text: 'Here is my plan' },
      { kind: 'completion', status: 'done', summary: 'Session complete' },
      { kind: 'plan-review', reviewId: 'review-1', agentId: 'claude-code', model: 'claude-sonnet-4-6' },
    ]

    const result = splitFinalAssistant(items)

    expect(result.finalAssistantText).toBe('Here is my plan')
    // The marker is pulled out of `renderable` so it does not appear above
    // the plan it belongs to.
    expect(result.renderable).toEqual([])
    expect(result.planReviewItems).toEqual([{ kind: 'plan-review', reviewId: 'review-1', agentId: 'claude-code', model: 'claude-sonnet-4-6' }])
  })
})

describe('streamItemReceivesRunningState', () => {
  it('does not keep an earlier tools group active after later output arrives', () => {
    const items: StreamItem[] = [
      {
        kind: 'ran-commands-group',
        id: 'turn-0-ran-1',
        type: 'other',
        items: [
          { kind: 'tool-call', name: 'shell', status: 'running' },
        ],
      },
      {
        kind: 'message',
        role: 'assistant',
        text: 'I found the next thing to inspect.',
      },
    ]

    expect(streamItemReceivesRunningState(items, 0, true)).toBe(false)
  })

  it('keeps only the trailing tools group eligible for live loading', () => {
    const items: StreamItem[] = [
      {
        kind: 'message',
        role: 'assistant',
        text: 'Checking tools.',
      },
      {
        kind: 'ran-commands-group',
        id: 'turn-0-ran-1',
        type: 'other',
        items: [
          { kind: 'tool-call', name: 'shell', status: 'running' },
        ],
      },
    ]

    expect(streamItemReceivesRunningState(items, 1, true)).toBe(true)
  })
})

describe('flattenCodeChangeFallbacks', () => {
  it('sums repeated edits to one file and keeps the latest change type', () => {
    const items: StreamItem[] = [
      {
        kind: 'file-change',
        filePath: 'src/a.ts',
        changeType: 'modified',
        additions: 2,
        deletions: 1,
        status: 'pending',
      },
      {
        kind: 'edited-files-group',
        id: 'turn-1-edits-1',
        items: [
          {
            kind: 'file-change',
            filePath: 'src/b.ts',
            changeType: 'added',
            additions: 8,
            deletions: 0,
            status: 'pending',
          },
          {
            kind: 'file-change',
            filePath: 'src/a.ts',
            changeType: 'deleted',
            additions: 0,
            deletions: 12,
            status: 'pending',
          },
        ],
      },
      {
        kind: 'diff-summary',
        filesChanged: 2,
        additions: 8,
        deletions: 12,
        summary: '2 files changed',
      },
    ]

    expect(flattenCodeChangeFallbacks(items)).toEqual([
      {
        filePath: 'src/a.ts',
        changeType: 'deleted',
        additions: 2,
        deletions: 13,
      },
      {
        filePath: 'src/b.ts',
        changeType: 'added',
        additions: 8,
        deletions: 0,
      },
    ])
  })
})

describe('visibleProposalsForFallbackFiles', () => {
  it('matches relative HTML file-change paths to absolute diff proposal paths', () => {
    const proposal = {
      filePath: '/Users/leo/project/index.html',
      originalContent: '<main>old</main>\n',
      proposedContent: '<main>new</main>\n',
      additions: 1,
      deletions: 1,
    }

    expect(
      visibleProposalsForFallbackFiles([proposal], [
        {
          filePath: '/repo/index.html',
          changeType: 'modified',
        },
      ]),
    ).toEqual([proposal])
  })

  it('keeps fallback rows when any changed file has no matching proposal yet', () => {
    const proposal = {
      filePath: '/Users/leo/project/src/app.ts',
      originalContent: 'old\n',
      proposedContent: 'new\n',
      additions: 1,
      deletions: 1,
    }

    expect(
      visibleProposalsForFallbackFiles([proposal], [
        {
          filePath: 'src/app.ts',
          changeType: 'modified',
        },
        {
          filePath: 'index.html',
          changeType: 'modified',
        },
      ]),
    ).toEqual([])
  })

  it('does not use basename fallback when multiple proposals share the name', () => {
    const proposals = [
      {
        filePath: '/Users/leo/project/index.html',
        originalContent: 'old\n',
        proposedContent: 'new\n',
      },
      {
        filePath: '/Users/leo/project/public/index.html',
        originalContent: 'old\n',
        proposedContent: 'new\n',
      },
    ]

    expect(
      visibleProposalsForFallbackFiles(proposals, [
        {
          filePath: '/repo/index.html',
          changeType: 'modified',
        },
      ]),
    ).toEqual([])
  })
})

describe('editedFileCardsForFallbackFiles', () => {
  it('builds one grouped card for the turn and keeps live counts beside matching proposals', () => {
    const htmlProposal = {
      filePath: '/Users/leo/project/index.html',
      originalContent: '<main>old</main>\n',
      proposedContent: '<main>new</main>\n',
      additions: 16,
      deletions: 1,
    }

    expect(
      editedFileCardsForFallbackFiles([htmlProposal], [
        {
          filePath: '/repo/index.html',
          changeType: 'modified',
          additions: 7,
          deletions: 0,
        },
        {
          filePath: 'src/app.ts',
          changeType: 'modified',
          additions: 2,
          deletions: 1,
        },
      ]),
    ).toEqual([
      {
        id: 'edited-files',
        proposals: [htmlProposal],
        fallbackFiles: [
          {
            filePath: '/Users/leo/project/index.html',
            changeType: 'modified',
            additions: 7,
            deletions: 0,
          },
          {
            filePath: 'src/app.ts',
            changeType: 'modified',
            additions: 2,
            deletions: 1,
          },
        ],
      },
    ])
  })
})

describe('editedFileCards', () => {
  it('does not mix unmatched global proposals into a turn-scoped edited-files card', () => {
    const appProposal = {
      filePath: '/Users/leo/project/src/app.ts',
      originalContent: 'old\n',
      proposedContent: 'new\n',
      additions: 1,
      deletions: 1,
    }
    const configProposal = {
      filePath: '/Users/leo/project/src/config.ts',
      originalContent: 'export const old = true\n',
      proposedContent: 'export const next = true\n',
      additions: 1,
      deletions: 1,
    }

    expect(
      editedFileCards(
        [appProposal, configProposal],
        [{ filePath: 'src/app.ts', changeType: 'modified', additions: 1, deletions: 1 }],
        { includeUnmatchedProposals: true },
      ),
    ).toEqual([
      {
        id: 'edited-files',
        proposals: [appProposal],
        fallbackFiles: [
          {
            filePath: '/Users/leo/project/src/app.ts',
            changeType: 'modified',
            additions: 1,
            deletions: 1,
          },
        ],
      },
    ])
  })

  it('renders proposal-only edits as one grouped card when no file-change activity exists', () => {
    const firstProposal = {
      filePath: '/Users/leo/project/src/a.ts',
      originalContent: 'old\n',
      proposedContent: 'new\n',
      additions: 1,
      deletions: 1,
    }
    const secondProposal = {
      filePath: '/Users/leo/project/src/b.ts',
      originalContent: 'old\n',
      proposedContent: 'new\n',
      additions: 2,
      deletions: 0,
    }

    expect(
      editedFileCards([firstProposal, secondProposal], [], {
        includeUnmatchedProposals: true,
      }),
    ).toEqual([
      {
        id: 'edited-files',
        proposals: [firstProposal, secondProposal],
        fallbackFiles: [],
      },
    ])
  })

  it('keeps the card identity stable while files are added to the live edit set', () => {
    const firstProposal = {
      filePath: '/Users/leo/project/src/a.ts',
      originalContent: 'old\n',
      proposedContent: 'new\n',
      additions: 1,
      deletions: 1,
    }
    const secondProposal = {
      filePath: '/Users/leo/project/src/b.ts',
      originalContent: 'old\n',
      proposedContent: 'new\n',
      additions: 2,
      deletions: 0,
    }

    const before = editedFileCards([firstProposal], [], {
      includeUnmatchedProposals: true,
    })
    const after = editedFileCards([firstProposal, secondProposal], [], {
      includeUnmatchedProposals: true,
    })

    expect(before).toHaveLength(1)
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(before[0].id)
  })
})
