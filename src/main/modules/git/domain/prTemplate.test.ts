import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadPrTemplate } from './prTemplate'

describe('loadPrTemplate', () => {
  let repoPath: string

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobrecs-pr-template-'))
  })

  afterEach(async () => {
    await fs.rm(repoPath, { recursive: true, force: true })
  })

  describe('GitHub template resolution', () => {
    it('returns default template when no file exists', async () => {
      const template = await loadPrTemplate(repoPath, 'github')
      expect(template).toContain('## Summary')
      expect(template).toContain('## Test plan')
    })

    it('loads .github/PULL_REQUEST_TEMPLATE.md when present', async () => {
      const githubDir = path.join(repoPath, '.github')
      await fs.mkdir(githubDir)
      await fs.writeFile(path.join(githubDir, 'PULL_REQUEST_TEMPLATE.md'), '## My custom template\n')

      const template = await loadPrTemplate(repoPath, 'github')
      expect(template).toBe('## My custom template\n')
    })

    it('loads lowercase .github/pull_request_template.md', async () => {
      const githubDir = path.join(repoPath, '.github')
      await fs.mkdir(githubDir)
      await fs.writeFile(path.join(githubDir, 'pull_request_template.md'), '## lowercase template\n')

      const template = await loadPrTemplate(repoPath, 'github')
      expect(template).toBe('## lowercase template\n')
    })

    it('loads docs/PULL_REQUEST_TEMPLATE.md as a lower-priority candidate', async () => {
      const docsDir = path.join(repoPath, 'docs')
      await fs.mkdir(docsDir)
      await fs.writeFile(path.join(docsDir, 'PULL_REQUEST_TEMPLATE.md'), '## docs template\n')

      const template = await loadPrTemplate(repoPath, 'github')
      expect(template).toBe('## docs template\n')
    })

    it('falls back to default when template file is empty', async () => {
      const githubDir = path.join(repoPath, '.github')
      await fs.mkdir(githubDir)
      await fs.writeFile(path.join(githubDir, 'PULL_REQUEST_TEMPLATE.md'), '   \n')

      const template = await loadPrTemplate(repoPath, 'github')
      expect(template).toContain('## Summary')
    })

    it('prefers .github/ over docs/', async () => {
      const githubDir = path.join(repoPath, '.github')
      const docsDir = path.join(repoPath, 'docs')
      await fs.mkdir(githubDir)
      await fs.mkdir(docsDir)
      await fs.writeFile(path.join(githubDir, 'PULL_REQUEST_TEMPLATE.md'), '## github template\n')
      await fs.writeFile(path.join(docsDir, 'PULL_REQUEST_TEMPLATE.md'), '## docs template\n')

      const template = await loadPrTemplate(repoPath, 'github')
      expect(template).toBe('## github template\n')
    })
  })

  describe('Azure template resolution', () => {
    it('returns default Azure template when no file exists', async () => {
      const template = await loadPrTemplate(repoPath, 'azure')
      expect(template).toContain('## Summary')
      expect(template).toContain('Related')
    })

    it('loads .azuredevops/pull_request_template.md when present', async () => {
      const azureDir = path.join(repoPath, '.azuredevops')
      await fs.mkdir(azureDir)
      await fs.writeFile(path.join(azureDir, 'pull_request_template.md'), '## Azure custom\n')

      const template = await loadPrTemplate(repoPath, 'azure')
      expect(template).toBe('## Azure custom\n')
    })
  })

  describe('unsupported provider', () => {
    it('returns empty string for unsupported provider type', async () => {
      const template = await loadPrTemplate(repoPath, 'unsupported')
      expect(template).toBe('')
    })
  })
})
