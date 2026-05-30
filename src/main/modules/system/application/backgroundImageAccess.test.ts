import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BackgroundImageAccess } from './backgroundImageAccess'

describe('BackgroundImageAccess', () => {
  it('imports selected images into app-managed storage before loading', async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'lobrecs-user-data-'))
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'lobrecs-selected-image-'))
    try {
      const sourcePath = path.join(sourceDir, 'Screen Shot.png')
      await writeFile(sourcePath, Buffer.from('image-bytes'))
      const access = new BackgroundImageAccess(userDataPath)

      const managedPath = await access.allowSelected(sourcePath)

      expect(managedPath).toContain(path.join(userDataPath, 'background-images'))
      expect(managedPath).not.toBe(sourcePath)
      expect(access.assertAllowed(managedPath)).toBe(managedPath)
      await expect(readFile(managedPath, 'utf8')).resolves.toBe('image-bytes')
    } finally {
      await rm(userDataPath, { recursive: true, force: true })
      await rm(sourceDir, { recursive: true, force: true })
    }
  })

  it('rejects renderer-provided paths outside app-managed storage', async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'lobrecs-user-data-'))
    try {
      const access = new BackgroundImageAccess(userDataPath)

      expect(() => access.assertAllowed(path.join(os.tmpdir(), 'outside.png'))).toThrow(
        'app-managed storage',
      )
      expect(() =>
        access.assertAllowed(path.join(userDataPath, 'background-images', '../outside.png')),
      ).toThrow('app-managed storage')
    } finally {
      await rm(userDataPath, { recursive: true, force: true })
    }
  })
})
