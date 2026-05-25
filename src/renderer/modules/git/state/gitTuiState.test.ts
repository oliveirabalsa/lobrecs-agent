import { describe, expect, it } from 'vitest'
import {
  getSelectedGitTuiItems,
  resolveGitTuiActionForCommand,
  resolveGitTuiKeyCommand,
  resolveNextGitPanel,
  resolveSelectionIndex,
  type GitRepositorySnapshot,
} from './gitTuiState'

describe('gitTuiState', () => {
  it('cycles focus like a keyboard-first TUI', () => {
    expect(resolveNextGitPanel('status', 'next')).toBe('files')
    expect(resolveNextGitPanel('stash', 'next')).toBe('status')
    expect(resolveNextGitPanel('status', 'previous')).toBe('stash')
  })

  it('maps lazygit-style keys to panel and repository commands', () => {
    expect(resolveGitTuiKeyCommand({ key: 'Tab' })).toEqual({ type: 'focus-next-panel' })
    expect(resolveGitTuiKeyCommand({ key: 'Tab', shiftKey: true })).toEqual({
      type: 'focus-prev-panel',
    })
    expect(resolveGitTuiKeyCommand({ key: '3' })).toEqual({
      type: 'focus-panel',
      panelId: 'branches',
    })
    expect(resolveGitTuiKeyCommand({ key: 'j' })).toEqual({
      type: 'move-selection',
      direction: 'down',
    })
    expect(resolveGitTuiKeyCommand({ key: '?' })).toEqual({ type: 'show-help' })
    expect(resolveGitTuiKeyCommand({ key: ':' })).toEqual({ type: 'show-palette' })
    expect(resolveGitTuiKeyCommand({ key: 'p' })).toEqual({ type: 'pull' })
    expect(resolveGitTuiKeyCommand({ key: 'P' })).toEqual({ type: 'push' })
  })

  it('maps c to commit and u to unstage', () => {
    expect(resolveGitTuiKeyCommand({ key: 'c' })).toEqual({ type: 'commit' })
    expect(resolveGitTuiKeyCommand({ key: 'u' })).toEqual({ type: 'unstage' })
  })

  it('maps h/l and arrow keys to panel navigation', () => {
    expect(resolveGitTuiKeyCommand({ key: 'h' })).toEqual({ type: 'focus-prev-panel' })
    expect(resolveGitTuiKeyCommand({ key: 'l' })).toEqual({ type: 'focus-next-panel' })
    expect(resolveGitTuiKeyCommand({ key: 'ArrowLeft' })).toEqual({ type: 'focus-prev-panel' })
    expect(resolveGitTuiKeyCommand({ key: 'ArrowRight' })).toEqual({ type: 'focus-next-panel' })
  })

  it('maps A to AI review', () => {
    expect(resolveGitTuiKeyCommand({ key: 'A' })).toEqual({ type: 'ai-review' })
  })

  it('keeps selection movement wrapped inside the active list', () => {
    expect(resolveSelectionIndex(0, 3, 'up')).toBe(2)
    expect(resolveSelectionIndex(2, 3, 'down')).toBe(0)
    expect(resolveSelectionIndex(0, 0, 'down')).toBe(0)
  })

  it('maps active-panel commands to explicit git actions', () => {
    const snapshot = makeSnapshot()
    const selected = getSelectedGitTuiItems(snapshot, {
      status: 0,
      files: 0,
      branches: 0,
      commits: 0,
      stash: 0,
    })

    expect(
      resolveGitTuiActionForCommand({ type: 'toggle-primary' }, 'files', selected),
    ).toEqual({ type: 'toggle-file-stage', path: 'src/app.ts', staged: false })
    expect(
      resolveGitTuiActionForCommand({ type: 'toggle-primary' }, 'branches', selected),
    ).toEqual({ type: 'checkout-branch', branchName: 'feature/git' })
    expect(
      resolveGitTuiActionForCommand({ type: 'open-detail' }, 'commits', selected),
    ).toEqual({ type: 'open-commit-detail', hash: 'abcdef123456' })
    expect(resolveGitTuiActionForCommand({ type: 'pull' }, 'status', selected)).toEqual({
      type: 'pull',
    })
  })

  it('resolves unstage command for staged files', () => {
    const snapshot = makeStagedSnapshot()
    const selected = getSelectedGitTuiItems(snapshot, {
      status: 0,
      files: 0,
      branches: 0,
      commits: 0,
      stash: 0,
    })

    expect(
      resolveGitTuiActionForCommand({ type: 'unstage' }, 'files', selected),
    ).toEqual({ type: 'unstage-file', path: 'src/app.ts' })
  })

  it('maps ai-review command to ai-review-diff action', () => {
    const snapshot = makeSnapshot()
    const selected = getSelectedGitTuiItems(snapshot, {
      status: 0,
      files: 0,
      branches: 0,
      commits: 0,
      stash: 0,
    })
    expect(
      resolveGitTuiActionForCommand({ type: 'ai-review' }, 'files', selected),
    ).toEqual({ type: 'ai-review-diff' })
  })

  it('returns none when unstage is used outside files panel or on unstaged file', () => {
    const snapshot = makeSnapshot()
    const selected = getSelectedGitTuiItems(snapshot, {
      status: 0,
      files: 0,
      branches: 0,
      commits: 0,
      stash: 0,
    })

    expect(
      resolveGitTuiActionForCommand({ type: 'unstage' }, 'files', selected),
    ).toEqual({ type: 'none' })

    expect(
      resolveGitTuiActionForCommand({ type: 'unstage' }, 'branches', selected),
    ).toEqual({ type: 'none' })
  })
})

function makeSnapshot(): GitRepositorySnapshot {
  return {
    projectId: 'project-1',
    repoPath: '/tmp/repo',
    branch: {
      currentBranch: 'main',
      detached: false,
      ahead: 0,
      behind: 0,
    },
    files: [
      {
        id: 'src/app.ts',
        path: 'src/app.ts',
        status: 'modified',
        staged: false,
        stagedStatus: 'unchanged',
        unstagedStatus: 'modified',
        stage: 'unstaged',
        conflict: false,
      },
    ],
    branches: [
      {
        name: 'feature/git',
        current: false,
        ahead: 0,
        behind: 0,
      },
    ],
    commits: [
      {
        sha: 'abcdef123456',
        hash: 'abcdef123456',
        shortSha: 'abcdef1',
        shortHash: 'abcdef1',
        subject: 'feat: add git tui',
        summary: 'feat: add git tui',
        author: 'Test Author',
        date: new Date(0).toISOString(),
        refs: [],
        graph: '*',
      },
    ],
    stash: [
      {
        ref: 'stash@{0}',
        id: 'stash@{0}',
        index: 0,
        sha: 'abcdef123456',
        message: 'wip',
        relativeDate: '1 second ago',
        date: new Date(0).toISOString(),
      },
    ],
    remotes: [],
    capturedAt: new Date(0).toISOString(),
  }
}

function makeStagedSnapshot(): GitRepositorySnapshot {
  return {
    ...makeSnapshot(),
    files: [
      {
        id: 'src/app.ts',
        path: 'src/app.ts',
        status: 'modified',
        staged: true,
        stagedStatus: 'modified',
        unstagedStatus: 'unchanged',
        stage: 'staged',
        conflict: false,
      },
    ],
  }
}
