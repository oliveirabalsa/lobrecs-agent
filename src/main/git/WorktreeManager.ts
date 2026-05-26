import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import type {
  WorktreeCleanupPolicy,
  WorktreeSnapshotStatus,
  WorktreeSessionMetadata,
} from '../../shared/types'

const execFileAsync = promisify(execFile)

type ManagedSessionWorktree = {
  branch: string
  repoPath: string
  worktreePath: string
}

type ManagedThreadWorktree = WorktreeSessionMetadata & {
  repoPath: string
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
  private readonly worktrees = new Map<string, ManagedSessionWorktree>()
  private readonly threadWorktrees = new Map<string, ManagedThreadWorktree>()

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

    const threadIds = [...this.threadWorktrees.entries()]
      .filter(([, metadata]) => !repoPath || metadata.repoPath === repoPath)
      .map(([threadId]) => threadId)

    for (const threadId of threadIds) {
      await this.removeThread(threadId, repoPath)
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

  async createThreadWorktree(
    input: {
      projectId: string
      threadId: string
      repoPath: string
      cleanupPolicy?: WorktreeCleanupPolicy
    },
  ): Promise<WorktreeSessionMetadata> {
    const existing = this.threadWorktrees.get(input.threadId)
    if (existing) return this.toPublicThreadMetadata(existing)

    await this.assertRepoHasHead(input.repoPath)

    const threadSlug = toSafeSlug(input.threadId)
    const branch = `agentforge/${threadSlug.slice(0, 16)}-${randomUUID().slice(0, 8)}`
    const worktreePath = path.join(
      os.tmpdir(),
      `agentforge-thread-${threadSlug.slice(0, 16)}-${randomUUID().slice(0, 8)}`,
    )
    const [baseBranch, baseCommit] = await Promise.all([
      this.resolveCurrentBranch(input.repoPath),
      this.resolveHead(input.repoPath),
    ])

    try {
      await runGit(['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], input.repoPath)
    } catch (error) {
      await fs.rm(worktreePath, { recursive: true, force: true })
      throw new WorktreeManagerError('Failed to create thread worktree', error)
    }

    const metadata: ManagedThreadWorktree = {
      projectId: input.projectId,
      threadId: input.threadId,
      location: 'worktree',
      repoPath: input.repoPath,
      worktreePath,
      branch,
      baseBranch,
      baseCommit,
      snapshotStatus: 'clean',
      cleanupPolicy: input.cleanupPolicy ?? 'manual',
      updatedAt: Date.now(),
    }
    this.threadWorktrees.set(input.threadId, metadata)
    return this.toPublicThreadMetadata(metadata)
  }

  getThreadWorktree(threadId: string): WorktreeSessionMetadata | null {
    const metadata = this.threadWorktrees.get(threadId)
    return metadata ? this.toPublicThreadMetadata(metadata) : null
  }

  getThreadWorktreePath(threadId: string): string | undefined {
    return this.threadWorktrees.get(threadId)?.worktreePath
  }

  async refreshThreadSnapshotStatus(threadId: string): Promise<WorktreeSnapshotStatus | null> {
    const metadata = this.threadWorktrees.get(threadId)
    if (!metadata?.worktreePath) return null

    const status = await this.snapshotStatus(metadata.worktreePath)
    metadata.snapshotStatus = status
    metadata.updatedAt = Date.now()
    return status
  }

  async createBranchForThread(
    threadId: string,
    branchName: string,
  ): Promise<WorktreeSessionMetadata> {
    const metadata = this.threadWorktrees.get(threadId)
    if (!metadata?.worktreePath) {
      throw new WorktreeManagerError('Thread is not attached to a worktree')
    }

    await runGit(['switch', '-c', branchName], metadata.worktreePath)
    metadata.branch = branchName
    metadata.snapshotStatus = await this.snapshotStatus(metadata.worktreePath)
    metadata.updatedAt = Date.now()
    return this.toPublicThreadMetadata(metadata)
  }

  async restoreThreadSnapshot(threadId: string): Promise<WorktreeSessionMetadata> {
    const metadata = this.threadWorktrees.get(threadId)
    if (!metadata?.worktreePath || !metadata.baseCommit) {
      throw new WorktreeManagerError('Thread worktree snapshot is not available')
    }

    await runGit(['reset', '--hard', metadata.baseCommit], metadata.worktreePath)
    await runGit(['clean', '-fd'], metadata.worktreePath)
    metadata.snapshotStatus = 'restored'
    metadata.updatedAt = Date.now()
    return this.toPublicThreadMetadata(metadata)
  }

  async removeThread(threadId: string, repoPath?: string): Promise<void> {
    const metadata = this.threadWorktrees.get(threadId)
    if (!metadata) return

    const targetRepoPath = repoPath ?? metadata.repoPath

    try {
      await runGit(['worktree', 'remove', '--force', metadata.worktreePath ?? ''], targetRepoPath)
    } catch {
      if (metadata.worktreePath) {
        await fs.rm(metadata.worktreePath, { recursive: true, force: true })
      }
    }

    if (metadata.branch) {
      try {
        await runGit(['branch', '-D', metadata.branch], targetRepoPath)
      } catch {
        // The branch may have been renamed or removed manually.
      }
    }

    this.threadWorktrees.delete(threadId)
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

  private async resolveCurrentBranch(repoPath: string): Promise<string | undefined> {
    try {
      const result = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)
      const branch = result.stdout.trim()
      return branch && branch !== 'HEAD' ? branch : undefined
    } catch {
      return undefined
    }
  }

  private async resolveHead(repoPath: string): Promise<string | undefined> {
    try {
      const result = await runGit(['rev-parse', 'HEAD'], repoPath)
      return result.stdout.trim() || undefined
    } catch {
      return undefined
    }
  }

  private async snapshotStatus(worktreePath: string): Promise<WorktreeSnapshotStatus> {
    try {
      const result = await runGit(
        ['status', '--porcelain=v1', '--untracked-files=all'],
        worktreePath,
      )
      const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim())
      if (lines.some((line) => line.startsWith('UU') || line.includes('U'))) {
        return 'conflicted'
      }
      return lines.length > 0 ? 'dirty' : 'clean'
    } catch {
      return 'missing'
    }
  }

  private toPublicThreadMetadata(metadata: ManagedThreadWorktree): WorktreeSessionMetadata {
    return {
      projectId: metadata.projectId,
      threadId: metadata.threadId,
      location: metadata.location,
      worktreePath: metadata.worktreePath,
      branch: metadata.branch,
      baseBranch: metadata.baseBranch,
      baseCommit: metadata.baseCommit,
      snapshotStatus: metadata.snapshotStatus,
      cleanupPolicy: metadata.cleanupPolicy,
      updatedAt: metadata.updatedAt,
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
