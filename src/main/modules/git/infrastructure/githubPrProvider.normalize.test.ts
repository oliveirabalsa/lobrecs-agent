import { describe, expect, it } from 'vitest'
import { normalizePullRequestSnapshot } from './githubPrProvider'

describe('normalizePullRequestSnapshot', () => {
  it('builds a unified patch and diff stat from GitHub file entries', () => {
    const snapshot = normalizePullRequestSnapshot({
      prNumber: 42,
      url: 'https://github.com/owner/repo/pull/42',
      title: 'feat: add greeting',
      state: 'open',
      baseBranch: 'main',
      headBranch: 'feature/greeting',
      baseSha: 'aaa111',
      headSha: 'bbb222',
      repoSlug: 'owner/repo',
      files: [
        {
          filename: 'src/greeting.ts',
          status: 'added',
          patch: '@@ -0,0 +1,2 @@\n+export const greet = () => "hi"\n+',
        },
        {
          filename: 'src/legacy.ts',
          status: 'removed',
          patch: '@@ -1,2 +0,0 @@\n-export const greet = () => "old"\n-',
        },
      ],
    })

    expect(snapshot.prNumber).toBe(42)
    expect(snapshot.repoSlug).toBe('owner/repo')
    expect(snapshot.changedFiles).toEqual([
      { path: 'src/greeting.ts', previousPath: undefined, status: 'added' },
      { path: 'src/legacy.ts', previousPath: undefined, status: 'deleted' },
    ])
    expect(snapshot.patch).toContain('diff --git a/src/greeting.ts b/src/greeting.ts')
    expect(snapshot.patch).toContain('+export const greet = () => "hi"')
    expect(snapshot.patch).toContain('diff --git a/src/legacy.ts b/src/legacy.ts')
    expect(snapshot.diffStat).toMatch(/2 files changed/)
  })

  it('preserves rename metadata via previous_filename', () => {
    const snapshot = normalizePullRequestSnapshot({
      prNumber: 7,
      url: 'https://github.com/o/r/pull/7',
      title: 't',
      state: 'open',
      baseBranch: 'main',
      headBranch: 'x',
      baseSha: '',
      headSha: '',
      repoSlug: 'o/r',
      files: [
        {
          filename: 'src/new.ts',
          previous_filename: 'src/old.ts',
          status: 'renamed',
          patch: '@@ -1 +1 @@\n-old\n+new',
        },
      ],
    })

    expect(snapshot.changedFiles).toEqual([
      { path: 'src/new.ts', previousPath: 'src/old.ts', status: 'renamed' },
    ])
    expect(snapshot.patch).toContain('diff --git a/src/old.ts b/src/new.ts')
    expect(snapshot.patch).toContain('--- a/src/old.ts')
    expect(snapshot.patch).toContain('+++ b/src/new.ts')
  })

  it('handles files without a patch (binary/no diff) gracefully', () => {
    const snapshot = normalizePullRequestSnapshot({
      prNumber: 1,
      url: 'https://github.com/o/r/pull/1',
      title: 't',
      state: 'open',
      baseBranch: 'main',
      headBranch: 'x',
      baseSha: '',
      headSha: '',
      repoSlug: 'o/r',
      files: [{ filename: 'icon.png', status: 'modified' }],
    })

    expect(snapshot.changedFiles).toEqual([
      { path: 'icon.png', previousPath: undefined, status: 'modified' },
    ])
    expect(snapshot.patch).toBe('')
    expect(snapshot.diffStat).toBe('')
  })

  it('maps merged state when the API reports it', () => {
    const snapshot = normalizePullRequestSnapshot({
      prNumber: 9,
      url: 'https://github.com/o/r/pull/9',
      title: 't',
      state: 'merged',
      baseBranch: 'main',
      headBranch: 'x',
      baseSha: '',
      headSha: '',
      repoSlug: 'o/r',
      files: [],
    })

    expect(snapshot.state).toBe('merged')
  })
})
