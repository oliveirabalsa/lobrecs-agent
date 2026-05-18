import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const STALE_DIFF_ERROR =
  'The file changed since this diff was generated. Review the latest file before applying.'
const MERGE_CONFLICT_ERROR =
  'The file changed since this diff was generated and could not be merged cleanly. Review the latest file before applying.'

export async function applyDiffContent(
  filePath: string,
  content: string,
  expectedContent?: string,
): Promise<void> {
  const existed = await fileExists(filePath)
  let contentToWrite = content

  if (expectedContent !== undefined) {
    const currentContent = existed ? await fs.readFile(filePath, 'utf-8') : ''
    if (currentContent === content) {
      return
    }
    if (currentContent !== expectedContent) {
      contentToWrite = await mergeWithLatestContent(currentContent, expectedContent, content)
    }
  }

  const backupPath = `${filePath}.lobrecs-agent-backup`
  if (existed) {
    await fs.copyFile(filePath, backupPath)
  } else {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
  }

  try {
    if (contentToWrite) {
      await fs.writeFile(filePath, contentToWrite, 'utf-8')
    } else if (existed) {
      await fs.unlink(filePath)
    }
  } catch (error) {
    if (existed) {
      await fs.copyFile(backupPath, filePath).catch(() => undefined)
    }
    throw error
  } finally {
    if (existed) {
      await fs.unlink(backupPath).catch(() => undefined)
    }
  }
}

async function mergeWithLatestContent(
  currentContent: string,
  expectedContent: string,
  proposedContent: string,
): Promise<string> {
  if (!proposedContent) {
    throw new Error(STALE_DIFF_ERROR)
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lobrecs-agent-merge-'))
  const currentPath = path.join(dir, 'current')
  const expectedPath = path.join(dir, 'expected')
  const proposedPath = path.join(dir, 'proposed')

  try {
    await Promise.all([
      fs.writeFile(currentPath, currentContent, 'utf-8'),
      fs.writeFile(expectedPath, expectedContent, 'utf-8'),
      fs.writeFile(proposedPath, proposedContent, 'utf-8'),
    ])

    const { stdout } = await execFileAsync(
      'git',
      ['merge-file', '-p', currentPath, expectedPath, proposedPath],
      {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      },
    )

    return stdout
  } catch {
    throw new Error(MERGE_CONFLICT_ERROR)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
