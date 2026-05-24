import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from '../../../git/WorktreeManager'
import { buildGitGraphData } from './gitGraphService'

describe('buildGitGraphData', () => {
  let rootPath: string
  let repoPath: string
  let worktreeManager: WorktreeManager

  beforeEach(() => {
    rootPath = mkdtempSync(path.join(tmpdir(), 'lobrecs-agent-graph-'))
    repoPath = path.join(rootPath, 'repo')
    worktreeManager = new WorktreeManager()

    git(['init', '--initial-branch=main', repoPath], rootPath)
    git(['config', 'user.email', 'test@example.com'], repoPath)
    git(['config', 'user.name', 'Test User'], repoPath)
    writeFileSync(path.join(repoPath, 'README.md'), 'initial\n')
    git(['add', 'README.md'], repoPath)
    git(['commit', '-m', 'chore: init'], repoPath)
  })

  afterEach(async () => {
    await worktreeManager.removeAll(repoPath).catch(() => {
      // worktree cleanup is best-effort during teardown
    })
    rmSync(rootPath, { recursive: true, force: true })
  })

  it('returns one node for a single-branch repo with isDefault=true and zero counts', async () => {
    const data = await buildGitGraphData('project-1', repoPath, worktreeManager)

    expect(data.projectId).toBe('project-1')
    expect(data.defaultBranch).toBe('main')
    expect(data.nodes).toHaveLength(1)

    const main = data.nodes[0]
    expect(main.branch).toBe('main')
    expect(main.isDefault).toBe(true)
    expect(main.aheadCount).toBe(0)
    expect(main.behindCount).toBe(0)
    expect(main.dirtyFileCount).toBe(0)
    expect(main.mergeStatus).toBe('clean')
    expect(main.headSha).toMatch(/^[a-f0-9]{40}$/)
  })

  it('reports a feature branch 2 commits ahead of main as ahead-only', async () => {
    git(['switch', '-c', 'feat/ahead'], repoPath)
    writeFileSync(path.join(repoPath, 'a.txt'), 'a\n')
    git(['add', 'a.txt'], repoPath)
    git(['commit', '-m', 'feat: a'], repoPath)
    writeFileSync(path.join(repoPath, 'b.txt'), 'b\n')
    git(['add', 'b.txt'], repoPath)
    git(['commit', '-m', 'feat: b'], repoPath)

    const data = await buildGitGraphData('p', repoPath, worktreeManager)
    const feature = data.nodes.find((node) => node.branch === 'feat/ahead')

    expect(feature).toBeDefined()
    expect(feature?.aheadCount).toBe(2)
    expect(feature?.behindCount).toBe(0)
    expect(feature?.mergeStatus).toBe('ahead-only')
    expect(feature?.recentCommits.length).toBe(2)
    expect(feature?.recentCommits[0]?.message).toBe('feat: b')
    expect(feature?.firstCommitDate).toMatch(/T/)
  })

  it('reports a branch that is purely behind main with behind status', async () => {
    git(['switch', '-c', 'feat/behind'], repoPath)
    git(['switch', 'main'], repoPath)
    writeFileSync(path.join(repoPath, 'forward.txt'), 'forward\n')
    git(['add', 'forward.txt'], repoPath)
    git(['commit', '-m', 'main: forward'], repoPath)

    const data = await buildGitGraphData('p', repoPath, worktreeManager)
    const branch = data.nodes.find((node) => node.branch === 'feat/behind')

    expect(branch).toBeDefined()
    expect(branch?.aheadCount).toBe(0)
    expect(branch?.behindCount).toBe(1)
    expect(branch?.mergeStatus).toBe('behind')
  })

  it('reports dirty file count from the worktree path for a worktree-bound branch', async () => {
    const sessionId = 'session-dirty'
    const worktreePath = await worktreeManager.create(sessionId, repoPath)
    const branch = worktreeManager.getBranch(sessionId)!

    writeFileSync(path.join(worktreePath, 'dirty.txt'), 'dirty\n')
    git(['add', 'dirty.txt'], worktreePath)
    git(['commit', '-m', 'feat: add dirty'], worktreePath)
    writeFileSync(path.join(worktreePath, 'pending.txt'), 'pending\n')

    const data = await buildGitGraphData('p', repoPath, worktreeManager)
    const node = data.nodes.find((entry) => entry.branch === branch)

    expect(node).toBeDefined()
    expect(node?.dirtyFileCount).toBeGreaterThan(0)
  })

  it('attaches sessionId and worktreePath to agentforge worktree branches', async () => {
    const sessionId = 'session-attach'
    const worktreePath = await worktreeManager.create(sessionId, repoPath)
    const branch = worktreeManager.getBranch(sessionId)!

    writeFileSync(path.join(worktreePath, 'note.txt'), 'note\n')
    git(['add', 'note.txt'], worktreePath)
    git(['commit', '-m', 'feat: note'], worktreePath)

    const data = await buildGitGraphData('p', repoPath, worktreeManager)
    const node = data.nodes.find((entry) => entry.branch === branch)

    expect(node).toBeDefined()
    expect(node?.sessionId).toBe(sessionId)
    expect(node?.worktreePath).toBe(worktreePath)
  })

  it('excludes fully merged non-worktree branches from the graph', async () => {
    git(['switch', '-c', 'feat/will-merge'], repoPath)
    writeFileSync(path.join(repoPath, 'merged.txt'), 'merged\n')
    git(['add', 'merged.txt'], repoPath)
    git(['commit', '-m', 'feat: merged'], repoPath)
    git(['switch', 'main'], repoPath)
    git(['merge', '--ff-only', 'feat/will-merge'], repoPath)

    const data = await buildGitGraphData('p', repoPath, worktreeManager)
    const merged = data.nodes.find((node) => node.branch === 'feat/will-merge')

    expect(merged).toBeUndefined()
    expect(data.nodes.find((node) => node.branch === 'main')).toBeDefined()
  })
})

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' })
}
