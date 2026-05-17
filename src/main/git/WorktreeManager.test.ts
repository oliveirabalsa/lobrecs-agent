import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorktreeManager, WorktreeManagerError } from './WorktreeManager'

describe('WorktreeManager', () => {
  let repoPath: string
  let manager: WorktreeManager

  beforeEach(() => {
    repoPath = mkdtempSync(path.join(tmpdir(), 'agentforge-test-'))
    manager = new WorktreeManager()
    git(['init'], repoPath)
    git(['config', 'user.email', 'test@example.com'], repoPath)
    git(['config', 'user.name', 'Test User'], repoPath)
    git(['commit', '--allow-empty', '-m', 'init'], repoPath)
  })

  afterEach(async () => {
    await manager.removeAll()
    rmSync(repoPath, { recursive: true, force: true })
  })

  it('creates and removes a worktree with an isolated branch', async () => {
    const worktreePath = await manager.create('session-123', repoPath)

    expect(worktreePath).toContain('agentforge-session-123')
    expect(manager.getPath('session-123')).toBe(worktreePath)
    expect(manager.getBranch('session-123')).toMatch(/^agentforge\/session-123-/)

    const branch = git(['branch', '--show-current'], worktreePath).trim()
    expect(branch).toBe(manager.getBranch('session-123'))

    await manager.remove('session-123', repoPath)

    expect(manager.getPath('session-123')).toBeUndefined()
    expect(git(['worktree', 'list'], repoPath)).not.toContain(worktreePath)
  })

  it('removes all worktrees for a repo', async () => {
    await manager.create('session-a', repoPath)
    await manager.create('session-b', repoPath)

    await manager.removeAll(repoPath)

    expect(manager.list()).toEqual([])
  })

  it('reports repositories without commits cleanly', async () => {
    const emptyRepoPath = mkdtempSync(path.join(tmpdir(), 'agentforge-empty-'))
    git(['init'], emptyRepoPath)

    await expect(manager.create('session-empty', emptyRepoPath)).rejects.toThrow(
      WorktreeManagerError,
    )

    rmSync(emptyRepoPath, { recursive: true, force: true })
  })
})

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' })
}
