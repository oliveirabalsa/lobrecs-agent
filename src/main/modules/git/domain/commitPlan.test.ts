import { describe, expect, it } from 'vitest'
import type { GitChangedFile, GitCommitSuggestion } from '../../../../shared/types'
import {
  normalizeSuggestedCommitPlan,
  validateCommitSuggestions,
} from './commitPlan'

const changedFiles: GitChangedFile[] = [
  { path: 'src/main/ipc.ts', status: 'modified' },
  { path: 'src/renderer/CommitAndPushDialog.tsx', status: 'modified' },
  { path: 'src/shared/contracts/git.ts', status: 'modified' },
]

describe('normalizeSuggestedCommitPlan', () => {
  it('extracts JSON suggestions and preserves the requested split', () => {
    const response = [
      '```json',
      JSON.stringify(
        {
          summary: 'Split the UI change from the IPC contract change.',
          commits: [
            {
              message: 'feat(workspace): refresh commit review modal',
              summary: 'Renderer updates for the new approve/edit flow.',
              files: ['src/renderer/CommitAndPushDialog.tsx'],
            },
            {
              message: 'feat(git): add planned commit contract',
              summary: 'Shared/main plumbing for commit planning.',
              files: ['src/main/ipc.ts', 'src/shared/contracts/git.ts'],
            },
          ],
        },
        null,
        2,
      ),
      '```',
    ].join('\n')

    const plan = normalizeSuggestedCommitPlan(response, changedFiles)

    expect(plan.summary).toBe('Split the UI change from the IPC contract change.')
    expect(plan.suggestions).toEqual([
      {
        id: 'commit-1',
        message: 'feat(workspace): refresh commit review modal',
        summary: 'Renderer updates for the new approve/edit flow.',
        files: ['src/renderer/CommitAndPushDialog.tsx'],
      },
      {
        id: 'commit-2',
        message: 'feat(git): add planned commit contract',
        summary: 'Shared/main plumbing for commit planning.',
        files: ['src/main/ipc.ts', 'src/shared/contracts/git.ts'],
      },
    ])
  })

  it('adds a fallback commit for files the model left behind', () => {
    const response = JSON.stringify({
      commits: [
        {
          message: 'workspace refresh',
          summary: 'Only mentions one file.',
          files: ['src/renderer/CommitAndPushDialog.tsx'],
        },
      ],
    })

    const plan = normalizeSuggestedCommitPlan(response, changedFiles)

    expect(plan.suggestions).toHaveLength(2)
    expect(plan.suggestions[0]).toMatchObject({
      message: 'chore(changes): workspace refresh',
      files: ['src/renderer/CommitAndPushDialog.tsx'],
    })
    expect(plan.suggestions[1]).toMatchObject({
      message: 'chore(changes): capture remaining edits',
      files: ['src/main/ipc.ts', 'src/shared/contracts/git.ts'],
    })
  })
})

describe('validateCommitSuggestions', () => {
  it('accepts a complete non-overlapping plan', () => {
    const suggestions: GitCommitSuggestion[] = [
      {
        id: 'commit-1',
        message: 'feat(workspace): refresh commit review modal',
        summary: 'Renderer flow.',
        files: ['src/renderer/CommitAndPushDialog.tsx'],
      },
      {
        id: 'commit-2',
        message: 'feat(git): add commit planning contract',
        summary: 'Shared/main plumbing.',
        files: ['src/main/ipc.ts', 'src/shared/contracts/git.ts'],
      },
    ]

    expect(validateCommitSuggestions(suggestions, changedFiles)).toBeNull()
  })

  it('rejects duplicate file assignments', () => {
    const suggestions: GitCommitSuggestion[] = [
      {
        id: 'commit-1',
        message: 'feat(workspace): refresh commit review modal',
        summary: 'Renderer flow.',
        files: ['src/renderer/CommitAndPushDialog.tsx', 'src/main/ipc.ts'],
      },
      {
        id: 'commit-2',
        message: 'feat(git): add commit planning contract',
        summary: 'Shared/main plumbing.',
        files: ['src/main/ipc.ts', 'src/shared/contracts/git.ts'],
      },
    ]

    expect(validateCommitSuggestions(suggestions, changedFiles)).toContain(
      'Each file can belong to only one commit',
    )
  })
})
