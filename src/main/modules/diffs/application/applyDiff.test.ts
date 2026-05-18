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
      'could not be merged cleanly',
    )
    await expect(fs.readFile(filePath, 'utf-8')).resolves.toBe('user edit')
  })

  it('merges proposed changes onto the latest file when edits do not conflict', async () => {
    await fs.writeFile(filePath, 'one\nuser edit\ntwo\nthree\n', 'utf-8')

    await applyDiffContent(filePath, 'one\ntwo\nagent edit\nthree\n', 'one\ntwo\nthree\n')

    await expect(fs.readFile(filePath, 'utf-8')).resolves.toBe(
      'one\nuser edit\ntwo\nagent edit\nthree\n',
    )
  })

  it('rejects stale deletions without removing latest local edits', async () => {
    await fs.writeFile(filePath, 'old\nuser edit\n', 'utf-8')

    await expect(applyDiffContent(filePath, '', 'old\n')).rejects.toThrow(
      'file changed since this diff was generated',
    )
    await expect(fs.readFile(filePath, 'utf-8')).resolves.toBe('old\nuser edit\n')
  })

  it('treats already-applied diffs as successful', async () => {
    await fs.writeFile(filePath, 'new', 'utf-8')

    await expect(applyDiffContent(filePath, 'new', 'old')).resolves.toBeUndefined()
    await expect(fs.readFile(filePath, 'utf-8')).resolves.toBe('new')
  })

  it('creates new files when the expected base is empty', async () => {
    const newFilePath = path.join(dir, 'nested', 'new-file.ts')

    await applyDiffContent(newFilePath, 'created', '')

    await expect(fs.readFile(newFilePath, 'utf-8')).resolves.toBe('created')
  })

  it('deletes files when proposed content is empty', async () => {
    await applyDiffContent(filePath, '', 'old')

    await expect(fs.access(filePath)).rejects.toThrow()
  })
})
