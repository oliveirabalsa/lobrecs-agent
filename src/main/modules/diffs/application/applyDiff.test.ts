import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyDiffContent } from './applyDiff'

describe('applyDiffContent', () => {
  let dir: string
  let filePath: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lobrecs-agent-diff-'))
    filePath = path.join(dir, 'file.ts')
    await fs.writeFile(filePath, 'old', 'utf-8')
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('applies content when the expected base still matches', async () => {
    await applyDiffContent(filePath, 'new', 'old')

    await expect(fs.readFile(filePath, 'utf-8')).resolves.toBe('new')
  })

  it('rejects stale diffs without changing the file', async () => {
    await fs.writeFile(filePath, 'user edit', 'utf-8')

    await expect(applyDiffContent(filePath, 'new', 'old')).rejects.toThrow(
      'file changed since this diff was generated',
    )
    await expect(fs.readFile(filePath, 'utf-8')).resolves.toBe('user edit')
  })
})
