import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCurrentBranchPushArgs, pushCurrentBranch } from './pushCurrentBranch'

describe('buildCurrentBranchPushArgs', () => {
  it('pushes HEAD to a same-name remote branch and sets upstream', () => {
    expect(buildCurrentBranchPushArgs('feat/new-branch', 'origin')).toEqual([
      'push',
      '--set-upstream',
      'origin',
      'HEAD:refs/heads/feat/new-branch',
    ])
  })

  it('requires a named branch', () => {
    expect(() => buildCurrentBranchPushArgs('HEAD', 'origin')).toThrow(
      'requires a named branch',
    )
  })
})

describe('pushCurrentBranch', () => {
  let rootPath: string
  let repoPath: string
  let remotePath: string

  beforeEach(() => {
    rootPath = mkdtempSync(path.join(tmpdir(), 'lobrecs-agent-push-'))
    repoPath = path.join(rootPath, 'repo')
    remotePath = path.join(rootPath, 'remote.git')

    git(['init', '--bare', remotePath], rootPath)
    git(['init', repoPath], rootPath)
    git(['config', 'user.email', 'test@example.com'], repoPath)
    git(['config', 'user.name', 'Test User'], repoPath)
    git(['branch', '-M', 'main'], repoPath)
    writeFileSync(path.join(repoPath, 'README.md'), 'initial\n')
    git(['add', 'README.md'], repoPath)
    git(['commit', '-m', 'chore: init'], repoPath)
    git(['remote', 'add', 'origin', remotePath], repoPath)
    git(['push', '--set-upstream', 'origin', 'main'], repoPath)
  })

  afterEach(() => {
    rmSync(rootPath, { recursive: true, force: true })
  })

  it('pushes a new local branch even when it tracks a differently named upstream', async () => {
    git(['switch', '-c', 'feat/new-branch'], repoPath)
    git(['branch', '--set-upstream-to=main', 'feat/new-branch'], repoPath)
    writeFileSync(path.join(repoPath, 'feature.txt'), 'feature\n')
    git(['add', 'feature.txt'], repoPath)
    git(['commit', '-m', 'feat: add feature'], repoPath)

    const result = await pushCurrentBranch(repoPath, 'feat/new-branch')

    expect(result.exitCode).toBe(0)
    expect(
      git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repoPath)
        .trim(),
    ).toBe('origin/feat/new-branch')
    expect(git(['show-ref', '--verify', 'refs/heads/feat/new-branch'], remotePath)).toContain(
      'refs/heads/feat/new-branch',
    )
  })
})

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' })
}
