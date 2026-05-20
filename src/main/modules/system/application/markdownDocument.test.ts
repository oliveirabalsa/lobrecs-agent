import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isMarkdownDocumentHref, readMarkdownDocument } from './markdownDocument'

describe('markdownDocument', () => {
  it('reads a repo-local markdown file', async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), 'lobrecs-md-'))
    try {
      await writeFile(path.join(repoPath, 'PLAN.md'), '# Plan\n\n- Build preview\n')

      const document = await readMarkdownDocument({ href: 'PLAN.md', repoPath })

      expect(document.title).toBe('PLAN.md')
      expect(document.suggestedFileName).toBe('PLAN.md')
      expect(document.content).toContain('Build preview')
      expect(document.sourcePath).toBe(path.join(repoPath, 'PLAN.md'))
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  it('rejects repo-relative escapes', async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), 'lobrecs-md-'))
    try {
      await expect(
        readMarkdownDocument({ href: '../outside.md', repoPath }),
      ).rejects.toThrow('inside the selected project')
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  it('detects markdown hrefs without accepting arbitrary links', () => {
    expect(isMarkdownDocumentHref('/tmp/notes.md')).toBe(true)
    expect(isMarkdownDocumentHref('docs/plan.markdown#top')).toBe(true)
    expect(isMarkdownDocumentHref('https://example.com/readme.mdx')).toBe(true)
    expect(isMarkdownDocumentHref('https://example.com/download.zip')).toBe(false)
    expect(isMarkdownDocumentHref('javascript:alert(1)')).toBe(false)
  })
})
