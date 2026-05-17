import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

type WorktreeMetadata = {
  branch: string
  repoPath: string
  worktreePath: string
}

export class WorktreeManagerError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'WorktreeManagerError'
  }
}

export class WorktreeManager {
  private readonly worktrees = new Map<string, WorktreeMetadata>()

  async create(sessionId: string, repoPath: string): Promise<string> {
    await this.assertRepoHasHead(repoPath)

    const sessionSlug = toSafeSlug(sessionId)
    const branch = `agentforge/${sessionSlug.slice(0, 16)}-${randomUUID().slice(0, 8)}`
    const worktreePath = path.join(
      os.tmpdir(),
      `agentforge-${sessionSlug.slice(0, 16)}-${randomUUID().slice(0, 8)}`,
    )

    try {
      await runGit(['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], repoPath)
    } catch (error) {
      await fs.rm(worktreePath, { recursive: true, force: true })
      throw new WorktreeManagerError('Failed to create git worktree', error)
    }

    this.worktrees.set(sessionId, { branch, repoPath, worktreePath })
    return worktreePath
  }

  async remove(sessionId: string, repoPath?: string): Promise<void> {
    const metadata = this.worktrees.get(sessionId)
    if (!metadata) return

    const targetRepoPath = repoPath ?? metadata.repoPath

    try {
      await runGit(['worktree', 'remove', '--force', metadata.worktreePath], targetRepoPath)
    } catch {
      await fs.rm(metadata.worktreePath, { recursive: true, force: true })
    }

    try {
      await runGit(['branch', '-D', metadata.branch], targetRepoPath)
    } catch {
      // A branch can already be gone if git cleaned it up or creation was interrupted.
    }

    this.worktrees.delete(sessionId)
  }

  async removeAll(repoPath?: string): Promise<void> {
    const sessionIds = [...this.worktrees.entries()]
      .filter(([, metadata]) => !repoPath || metadata.repoPath === repoPath)
      .map(([sessionId]) => sessionId)

    for (const sessionId of sessionIds) {
      await this.remove(sessionId, repoPath)
    }
  }

  getPath(sessionId: string): string | undefined {
    return this.worktrees.get(sessionId)?.worktreePath
  }

  getBranch(sessionId: string): string | undefined {
    return this.worktrees.get(sessionId)?.branch
  }

  reassignSession(previousSessionId: string, nextSessionId: string): void {
    if (previousSessionId === nextSessionId) return

    const metadata = this.worktrees.get(previousSessionId)
    if (!metadata) return
    if (this.worktrees.has(nextSessionId)) {
      throw new WorktreeManagerError(`Worktree already exists for session ${nextSessionId}`)
    }

    this.worktrees.delete(previousSessionId)
    this.worktrees.set(nextSessionId, metadata)
  }

  list(): Array<{ sessionId: string; branch: string; repoPath: string; worktreePath: string }> {
    return [...this.worktrees.entries()].map(([sessionId, metadata]) => ({
      sessionId,
      ...metadata,
    }))
  }

  private async assertRepoHasHead(repoPath: string): Promise<void> {
    try {
      await runGit(['rev-parse', '--verify', 'HEAD'], repoPath)
    } catch (error) {
      throw new WorktreeManagerError(
        'Cannot create a worktree before the repository has an initial commit',
        error,
      )
    }
  }
}

async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  })

  return { stdout, stderr }
}

function toSafeSlug(value: string): string {
  const slug = value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'session'
}

export const worktreeManager = new WorktreeManager()
