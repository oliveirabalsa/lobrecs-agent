import { describe, expect, it } from 'vitest'
import { normalizeDiffReview } from './diffReview'
import type { GitChangedFile } from '../../../../shared/types'

describe('normalizeDiffReview', () => {
  const changedFiles: GitChangedFile[] = [
    { path: 'src/app.ts', status: 'modified' },
  ]

  it('normalizes structured review findings', () => {
    const review = normalizeDiffReview(
      JSON.stringify({
        summary: 'One issue found.',
        findings: [
          {
            severity: 'high',
            category: 'regression',
            title: 'Missing empty-state guard',
            detail: 'The new branch dereferences undefined data.',
            filePath: 'src/app.ts',
            line: 42,
            recommendation: 'Guard before rendering.',
          },
        ],
      }),
      changedFiles,
    )

    expect(review).toEqual({
      summary: 'One issue found.',
      findings: [
        {
          id: 'finding-1',
          severity: 'high',
          category: 'regression',
          title: 'Missing empty-state guard',
          detail: 'The new branch dereferences undefined data.',
          filePath: 'src/app.ts',
          line: 42,
          recommendation: 'Guard before rendering.',
        },
      ],
    })
  })

  it('falls back to an empty finding list for invalid JSON', () => {
    expect(normalizeDiffReview('No issues.', changedFiles)).toEqual({
      summary: 'No concrete issues found in the current diff.',
      findings: [],
      rawOutput: 'No issues.',
    })
  })
})
