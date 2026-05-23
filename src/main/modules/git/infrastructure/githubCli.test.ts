import { describe, expect, it } from 'vitest'
import { buildGhPrCreateArgs } from './githubCli'

describe('buildGhPrCreateArgs', () => {
  it('passes both base and selected head branch to gh pr create', () => {
    expect(buildGhPrCreateArgs({
      title: 'feat: Improve PR flow',
      body: '## Summary\n\nUses the PR template.',
      baseBranch: 'main',
      headBranch: 'feat/general_improvements',
    })).toEqual([
      'pr',
      'create',
      '--title',
      'feat: Improve PR flow',
      '--body',
      '## Summary\n\nUses the PR template.',
      '--base',
      'main',
      '--head',
      'feat/general_improvements',
    ])
  })
})
