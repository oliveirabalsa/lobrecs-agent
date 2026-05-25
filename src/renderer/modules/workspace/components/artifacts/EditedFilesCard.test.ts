import { describe, expect, it } from 'vitest'
import {
  areFileRowPropsEqual,
  buildEditedFileEntries,
  visibleEditedFileEntries,
} from './EditedFilesCard'
import type { DiffProposal } from '../../../../../shared/types'

describe('visibleEditedFileEntries', () => {
  it('shows the first five already-ordered edited files by default', () => {
    expect(
      visibleEditedFileEntries(
        ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'],
        false,
      ),
    ).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'])
  })

  it('shows every edited file after expansion', () => {
    expect(
      visibleEditedFileEntries(
        ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'],
        true,
      ),
    ).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'])
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
        additions: 10,
        deletions: 1,
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

  it('orders distinct fallback-only rows by newest edit first', () => {
    expect(
      buildEditedFileEntries([], [
        { filePath: 'src/oldest.ts', additions: 1, deletions: 0, changeType: 'modified' },
        { filePath: 'src/middle.ts', additions: 2, deletions: 0, changeType: 'modified' },
        { filePath: 'src/newest.ts', additions: 3, deletions: 0, changeType: 'modified' },
      ]),
    ).toEqual([
      {
        filePath: 'src/newest.ts',
        additions: 3,
        deletions: 0,
      },
      {
        filePath: 'src/middle.ts',
        additions: 2,
        deletions: 0,
      },
      {
        filePath: 'src/oldest.ts',
        additions: 1,
        deletions: 0,
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

  it('orders proposal-backed rows by fallback edit order when fallback metadata exists', () => {
    const olderProposal = {
      filePath: '/Users/leo/project/src/older.ts',
      originalContent: 'old\n',
      proposedContent: 'new\n',
      additions: 10,
      deletions: 1,
    }
    const newerProposal = {
      filePath: '/Users/leo/project/src/newer.ts',
      originalContent: 'old\n',
      proposedContent: 'new\n',
      additions: 10,
      deletions: 1,
    }

    expect(
      buildEditedFileEntries([newerProposal, olderProposal], [
        {
          filePath: 'src/older.ts',
          additions: 1,
          deletions: 0,
          changeType: 'modified',
        },
        {
          filePath: 'src/newer.ts',
          additions: 2,
          deletions: 0,
          changeType: 'modified',
        },
      ]),
    ).toEqual([
      {
        filePath: '/Users/leo/project/src/newer.ts',
        additions: 10,
        deletions: 1,
        proposal: newerProposal,
      },
      {
        filePath: '/Users/leo/project/src/older.ts',
        additions: 10,
        deletions: 1,
        proposal: olderProposal,
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

describe('areFileRowPropsEqual', () => {
  const onOpenDiff = () => undefined
  const onReview = () => undefined

  it('keeps an unchanged row memoized when its entry object is rebuilt', () => {
    expect(
      areFileRowPropsEqual(
        {
          entry: {
            filePath: 'src/app.ts',
            additions: 2,
            deletions: 1,
          },
          onReview,
          onOpenDiff,
        },
        {
          entry: {
            filePath: 'src/app.ts',
            additions: 2,
            deletions: 1,
          },
          onReview,
          onOpenDiff,
        },
      ),
    ).toBe(true)
  })

  it('keeps an unchanged proposal-backed row memoized when the proposal object is rebuilt', () => {
    const proposal: DiffProposal = {
      filePath: '/Users/leo/project/src/app.ts',
      originalContent: 'old\n',
      proposedContent: 'new\n',
      additions: 1,
      deletions: 1,
      status: 'pending',
    }

    expect(
      areFileRowPropsEqual(
        {
          entry: {
            filePath: proposal.filePath,
            additions: 1,
            deletions: 1,
            proposal,
          },
          onReview,
          onOpenDiff,
        },
        {
          entry: {
            filePath: proposal.filePath,
            additions: 1,
            deletions: 1,
            proposal: { ...proposal },
          },
          onReview,
          onOpenDiff,
        },
      ),
    ).toBe(true)
  })

  it('marks only the edited row as changed when its stats change', () => {
    expect(
      areFileRowPropsEqual(
        {
          entry: {
            filePath: 'src/app.ts',
            additions: 2,
            deletions: 1,
          },
          onReview,
          onOpenDiff,
        },
        {
          entry: {
            filePath: 'src/app.ts',
            additions: 3,
            deletions: 1,
          },
          onReview,
          onOpenDiff,
        },
      ),
    ).toBe(false)
  })

  it('updates a row when rebuilt proposal content changes', () => {
    const proposal: DiffProposal = {
      filePath: '/Users/leo/project/src/app.ts',
      originalContent: 'old\n',
      proposedContent: 'new\n',
      additions: 1,
      deletions: 1,
    }

    expect(
      areFileRowPropsEqual(
        {
          entry: {
            filePath: proposal.filePath,
            additions: 1,
            deletions: 1,
            proposal,
          },
          onReview,
          onOpenDiff,
        },
        {
          entry: {
            filePath: proposal.filePath,
            additions: 1,
            deletions: 1,
            proposal: { ...proposal, proposedContent: 'newer\n' },
          },
          onReview,
          onOpenDiff,
        },
      ),
    ).toBe(false)
  })
})
