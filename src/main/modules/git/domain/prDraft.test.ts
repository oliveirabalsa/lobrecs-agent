import { describe, expect, it } from 'vitest'
import { buildPrDraftPrompt, createDraftTitle } from './prDraft'

describe('buildPrDraftPrompt', () => {
  it('includes the repository PR template as the required body structure', () => {
    const prompt = buildPrDraftPrompt({
      headBranch: 'feat/pr-flow',
      baseBranch: 'main',
      commits: 'abc123 feat: improve PR flow',
      diffStat: 'src/main/modules/git/application/pullRequestWorkflowService.ts | 12 +++++',
      template: '## Summary\n\n<!-- Describe changes -->\n\n## Testing\n\n- [ ] Tests pass\n',
    })

    expect(prompt).toContain('Pull request template to follow:')
    expect(prompt).toContain('## Summary')
    expect(prompt).toContain('## Testing')
    expect(prompt).toContain('- [ ] Tests pass')
    expect(prompt).toContain('Preserve its headings and checklist items')
    expect(prompt).toContain('markdown PR description that follows the provided template')
  })
})

describe('createDraftTitle', () => {
  it('derives a conventional fallback title from the source branch', () => {
    expect(createDraftTitle('feat/general_improvements', 'main')).toBe('feat: General improvements -> main')
  })
})
