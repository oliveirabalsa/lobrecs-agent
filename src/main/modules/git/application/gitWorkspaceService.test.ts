import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitWorkspaceService } from './gitWorkspaceService'

describe('GitWorkspaceService', () => {
  let rootPath: string
  let repoPath: string
  let service: GitWorkspaceService

  beforeEach(() => {
    rootPath = mkdtempSync(path.join(tmpdir(), 'lobrecs-agent-git-workspace-'))
    repoPath = path.join(rootPath, 'repo')
    service = new GitWorkspaceService()

    git(['init', '--initial-branch=main', repoPath], rootPath)
    git(['config', 'user.email', 'test@example.com'], repoPath)
    git(['config', 'user.name', 'Test User'], repoPath)
    writeFileSync(path.join(repoPath, 'README.md'), 'initial\n')
    git(['add', 'README.md'], repoPath)
    git(['commit', '-m', 'chore: init'], repoPath)
  })

  afterEach(() => {
    rmSync(rootPath, { recursive: true, force: true })
  })

  it('collects a serializable repository snapshot', async () => {
    writeFileSync(path.join(repoPath, 'feature.txt'), 'feature\n')
    git(['switch', '-c', 'feat/native-git'], repoPath)
    git(['add', 'feature.txt'], repoPath)
    git(['commit', '-m', 'feat: native git'], repoPath)
    writeFileSync(path.join(repoPath, 'pending.txt'), 'pending\n')

    const snapshot = await service.getSnapshot(repoPath, {
      projectId: 'project-1',
      commitLimit: 5,
    })

    expect(snapshot.projectId).toBe('project-1')
    expect(snapshot.repoPath).toBe(repoPath)
    expect(snapshot.branch.currentBranch).toBe('feat/native-git')
    expect(snapshot.files).toEqual([
      {
        id: 'pending.txt',
        path: 'pending.txt',
        status: 'untracked',
        staged: false,
        stagedStatus: 'unchanged',
        unstagedStatus: 'untracked',
        stage: 'untracked',
        conflict: false,
      },
    ])
    expect(snapshot.branches.map((branch) => branch.name)).toContain('main')
    expect(snapshot.commits[0]?.subject).toBe('feat: native git')
    expect(snapshot.capturedAt).toMatch(/T/)
  })

  it('stages and unstages a single file without using generic shell passthrough', async () => {
    writeFileSync(path.join(repoPath, 'feature.txt'), 'feature\n')

    const staged = await service.stageFile(repoPath, {
      projectId: 'project-1',
      path: 'feature.txt',
    })
    expect(staged.ok).toBe(true)
    expect(git(['diff', '--cached', '--name-only'], repoPath).trim()).toBe('feature.txt')

    const unstaged = await service.unstageFile(repoPath, {
      projectId: 'project-1',
      path: 'feature.txt',
    })
    expect(unstaged.ok).toBe(true)
    expect(git(['diff', '--cached', '--name-only'], repoPath).trim()).toBe('')
  })

  it('requires confirmation for stash pop and drop operations', async () => {
    writeFileSync(path.join(repoPath, 'stash.txt'), 'stash\n')
    git(['stash', 'push', '-u', '-m', 'save work'], repoPath)

    const pop = await service.popStash(repoPath, {
      projectId: 'project-1',
      ref: 'stash@{0}',
    })
    const drop = await service.dropStash(repoPath, {
      projectId: 'project-1',
      ref: 'stash@{0}',
    })

    expect(pop.requiresConfirmation).toBe(true)
    expect(pop.ok).toBe(false)
    expect(drop.requiresConfirmation).toBe(true)
    expect(drop.ok).toBe(false)
    expect(git(['stash', 'list'], repoPath)).toContain('stash@{0}')
  })
})

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' })
}
