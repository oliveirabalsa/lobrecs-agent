import { describe, expect, it } from 'vitest'
import type { DiffProposal } from '../../../../shared/types'
import type { StreamItem } from '../lib/groupTurns'
import {
  editedFileCards,
  flattenCodeChangeFallbacks,
  shouldPinMessageStream,
  splitFinalAssistant,
  streamItemReceivesRunningState,
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

  it('keeps running code changes in the inline renderable stream', () => {
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
      codeChange,
      { kind: 'message', role: 'assistant', text: 'still editing' },
    ])
  })

  it('keeps edited files inline before the separated final assistant message', () => {
    const codeChange = {
      kind: 'file-change',
      filePath: 'src/example.ts',
      changeType: 'modified',
      status: 'pending',
    } satisfies Extract<StreamItem, { kind: 'file-change' }>
    const items: StreamItem[] = [
      { kind: 'message', role: 'assistant', text: 'final answer' },
      { kind: 'completion', status: 'done', summary: 'Session complete' },
      codeChange,
    ]

    const result = splitFinalAssistant(items)

    expect(result.finalAssistantText).toBe('final answer')
    expect(result.renderable).toEqual([codeChange])
  })

  it('keeps code changes in the inline stream when they follow the final answer', () => {
    const codeChange = {
      kind: 'file-change',
      filePath: 'src/example.ts',
      changeType: 'modified',
      status: 'pending',
    } satisfies Extract<StreamItem, { kind: 'file-change' }>
    const items: StreamItem[] = [
      { kind: 'message', role: 'assistant', text: 'summary' },
      codeChange,
      { kind: 'completion', status: 'done', summary: 'Session complete' },
    ]

    const result = splitFinalAssistant(items)

    expect(result.finalAssistantText).toBe('summary')
    expect(result.renderable).toEqual([codeChange])
  })

  it('extracts plan-review markers so they render below the final plan', () => {
    const items: StreamItem[] = [
      { kind: 'message', role: 'assistant', text: 'Here is my plan' },
      { kind: 'completion', status: 'done', summary: 'Session complete' },
      {
        kind: 'plan-review',
        reviewId: 'review-1',
        agentId: 'claude-code',
        model: 'claude-sonnet-4-6',
      },
    ]

    const result = splitFinalAssistant(items)

    expect(result.finalAssistantText).toBe('Here is my plan')
    // The marker is pulled out of `renderable` so it does not appear above
    // the plan it belongs to.
    expect(result.renderable).toEqual([])
    expect(result.planReviewItems).toEqual([
      {
        kind: 'plan-review',
        reviewId: 'review-1',
        agentId: 'claude-code',
        model: 'claude-sonnet-4-6',
      },
    ])
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

describe('editedFileCards', () => {
  const proposal: DiffProposal = {
    filePath: '/repo/src/app.ts',
    originalContent: 'old\n',
    proposedContent: 'new\n',
    additions: 1,
    deletions: 1,
  }

  it('creates a proposal-only card when the active turn has no file-change rows', () => {
    expect(
      editedFileCards([proposal], [], { includeUnmatchedProposals: true }),
    ).toEqual([
      {
        id: 'edited-files',
        proposals: [proposal],
        fallbackFiles: [],
      },
    ])
  })

  it('keeps proposal-only cards even when line counts must be derived by the card', () => {
    const contentOnlyProposal: DiffProposal = {
      filePath: '/repo/src/content-only.ts',
      originalContent: 'old\n',
      proposedContent: 'new\n',
    }

    expect(
      editedFileCards([contentOnlyProposal], [], { includeUnmatchedProposals: true }),
    ).toEqual([
      {
        id: 'edited-files',
        proposals: [contentOnlyProposal],
        fallbackFiles: [],
      },
    ])
  })

  it('does not create proposal-only cards for non-active turns', () => {
    expect(
      editedFileCards([proposal], [], { includeUnmatchedProposals: false }),
    ).toEqual([])
  })

  it('keeps file-change-backed rows as the source of turn attribution', () => {
    expect(
      editedFileCards(
        [proposal],
        [
          {
            filePath: 'src/app.ts',
            additions: 1,
            deletions: 1,
            changeType: 'modified',
          },
        ],
        { includeUnmatchedProposals: true },
      ),
    ).toEqual([
      {
        id: 'edited-files',
        proposals: [proposal],
        fallbackFiles: [
          {
            filePath: '/repo/src/app.ts',
            additions: 1,
            deletions: 1,
            changeType: 'modified',
          },
        ],
      },
    ])
  })
})
