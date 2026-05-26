import { describe, expect, it } from 'vitest'
import { buildPrReviewPrompt } from './prReview'

describe('buildPrReviewPrompt', () => {
  it('includes PR metadata, changed files, and patch sections', () => {
    const prompt = buildPrReviewPrompt({
      prNumber: 42,
      url: 'https://github.com/owner/repo/pull/42',
      title: 'fix: null guard',
      state: 'open',
      baseBranch: 'main',
      headBranch: 'feature/x',
      baseSha: 'aaa111',
      headSha: 'bbb222',
      repoSlug: 'owner/repo',
      changedFiles: [
        { path: 'src/a.ts', status: 'modified' },
        { path: 'src/b.ts', previousPath: 'src/old.ts', status: 'renamed' },
      ],
      patch: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y',
      diffStat: ' 2 files changed, 1 insertion(+), 1 deletion(-)',
    })

    expect(prompt).toContain('pull request #42')
    expect(prompt).toContain('owner/repo')
    expect(prompt).toContain('main (aaa111)')
    expect(prompt).toContain('feature/x (bbb222)')
    expect(prompt).toContain('- modified: src/a.ts')
    expect(prompt).toContain('- renamed: src/old.ts -> src/b.ts')
    expect(prompt).toContain('diff --git a/src/a.ts')
    expect(prompt).toContain('"severity": "critical | high | medium | low"')
  })

  it('handles empty diff metadata gracefully', () => {
    const prompt = buildPrReviewPrompt({
      prNumber: 1,
      url: 'https://github.com/o/r/pull/1',
      title: 't',
      state: 'open',
      baseBranch: 'main',
      headBranch: 'x',
      baseSha: '',
      headSha: '',
      repoSlug: 'o/r',
      changedFiles: [],
      patch: '',
      diffStat: '',
    })

    expect(prompt).toContain('(no changed files)')
    expect(prompt).toContain('(no diff stat available)')
    expect(prompt).toContain('(patch is empty)')
  })
})
