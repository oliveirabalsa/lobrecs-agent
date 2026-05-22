import { describe, expect, it } from 'vitest'
import {
  buildEditedFileEntries,
  visibleEditedFileEntries,
} from './EditedFilesCard'

describe('visibleEditedFileEntries', () => {
  it('shows the first three already-ordered edited files by default', () => {
    expect(visibleEditedFileEntries(['a.ts', 'b.ts', 'c.ts', 'd.ts'], false)).toEqual([
      'a.ts',
      'b.ts',
      'c.ts',
    ])
  })

  it('shows every edited file after expansion', () => {
    expect(visibleEditedFileEntries(['a.ts', 'b.ts', 'c.ts', 'd.ts'], true)).toEqual([
      'a.ts',
      'b.ts',
      'c.ts',
      'd.ts',
    ])
  })
})

describe('buildEditedFileEntries', () => {
  it('keeps fallback-only files when the same card also has proposal-backed files', () => {
    const proposal = {
      filePath: '/Users/leo/project/src/app.ts',
      originalContent: 'old\n',
      proposedContent: 'new\n',
      additions: 10,
      deletions: 1,
    }

    expect(
      buildEditedFileEntries([proposal], [
        {
          filePath: 'src/app.ts',
          additions: 3,
          deletions: 0,
          changeType: 'modified',
        },
        {
          filePath: 'src/settings.ts',
          additions: 2,
          deletions: 1,
          changeType: 'modified',
        },
      ]),
    ).toEqual([
      {
        filePath: 'src/settings.ts',
        additions: 2,
        deletions: 1,
      },
      {
        filePath: '/Users/leo/project/src/app.ts',
        additions: 3,
        deletions: 0,
        proposal,
      },
    ])
  })

  it('sums repeated fallback edits before rendering rows', () => {
    expect(
      buildEditedFileEntries([], [
        { filePath: 'src/app.ts', additions: 1, deletions: 0, changeType: 'modified' },
        { filePath: 'src/app.ts', additions: 2, deletions: 1, changeType: 'modified' },
      ]),
    ).toEqual([
      {
        filePath: 'src/app.ts',
        additions: 3,
        deletions: 1,
      },
    ])
  })

  it('orders fallback rows by the last edit first', () => {
    expect(
      buildEditedFileEntries([], [
        { filePath: 'src/first.ts', additions: 1, deletions: 0, changeType: 'modified' },
        { filePath: 'src/second.ts', additions: 1, deletions: 0, changeType: 'modified' },
        { filePath: 'src/first.ts', additions: 1, deletions: 0, changeType: 'modified' },
      ]),
    ).toEqual([
      {
        filePath: 'src/first.ts',
        additions: 2,
        deletions: 0,
      },
      {
        filePath: 'src/second.ts',
        additions: 1,
        deletions: 0,
      },
    ])
  })

  it('orders proposal rows by the last proposal first when no fallback exists', () => {
    const firstProposal = {
      filePath: '/Users/leo/project/src/first.ts',
      originalContent: 'old\n',
      proposedContent: 'new\n',
      additions: 1,
      deletions: 1,
    }
    const secondProposal = {
      filePath: '/Users/leo/project/src/second.ts',
      originalContent: 'old\n',
      proposedContent: 'new\n',
      additions: 1,
      deletions: 1,
    }

    expect(buildEditedFileEntries([firstProposal, secondProposal], undefined)).toEqual([
      {
        filePath: '/Users/leo/project/src/second.ts',
        additions: 1,
        deletions: 1,
        proposal: secondProposal,
      },
      {
        filePath: '/Users/leo/project/src/first.ts',
        additions: 1,
        deletions: 1,
        proposal: firstProposal,
      },
    ])
  })

  it('uses proposal stats when a matching fallback has no line changes', () => {
    const proposal = {
      filePath: '/Users/leo/project/src/app.ts',
      originalContent: 'old\n',
      proposedContent: 'new\n',
      additions: 1,
      deletions: 1,
    }

    expect(
      buildEditedFileEntries([proposal], [
        {
          filePath: 'src/app.ts',
          additions: 0,
          deletions: 0,
          changeType: 'modified',
        },
      ]),
    ).toEqual([
      {
        filePath: '/Users/leo/project/src/app.ts',
        additions: 1,
        deletions: 1,
        proposal,
      },
    ])
  })

  it('filters no-op fallback rows instead of rendering +0 -0 entries', () => {
    expect(
      buildEditedFileEntries([], [
        {
          filePath: 'src/noop.ts',
          additions: 0,
          deletions: 0,
          changeType: 'modified',
        },
      ]),
    ).toEqual([])
  })

  it('filters proposal rows whose contents produce no visible diff', () => {
    const proposal = {
      filePath: '/Users/leo/project/src/noop.ts',
      originalContent: 'same\n',
      proposedContent: 'same\n',
      additions: 0,
      deletions: 0,
    }

    expect(buildEditedFileEntries([proposal], undefined)).toEqual([])
  })
})
