import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDiffProposals } from './worktreeDiff'

const execFileAsync = promisify(execFile)

describe('buildDiffProposals', () => {
  let repoPath: string
  let targetRepoPath: string

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobrecs-agent-worktree-diff-'))
    targetRepoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobrecs-agent-target-'))

    await git(repoPath, ['init'])
    await git(repoPath, ['config', 'user.email', 'agent@example.test'])
    await git(repoPath, ['config', 'user.name', 'Agent Test'])
    await fs.mkdir(path.join(repoPath, 'src'), { recursive: true })
    await fs.writeFile(path.join(repoPath, 'src', 'existing.ts'), 'old\n', 'utf-8')
    await git(repoPath, ['add', '.'])
    await git(repoPath, ['commit', '-m', 'initial commit'])
  })

  afterEach(async () => {
    await fs.rm(repoPath, { recursive: true, force: true })
    await fs.rm(targetRepoPath, { recursive: true, force: true })
  })

  it('includes tracked edits and untracked files with full proposal content', async () => {
    await fs.writeFile(path.join(repoPath, 'src', 'existing.ts'), 'old\nnew\n', 'utf-8')
    await fs.writeFile(path.join(repoPath, 'src', 'created.ts'), 'created\n', 'utf-8')

    const proposals = await buildDiffProposals(repoPath, targetRepoPath)

    const modified = proposals.find(
      (proposal) => proposal.filePath === path.join(targetRepoPath, 'src', 'existing.ts'),
    )
    const created = proposals.find(
      (proposal) => proposal.filePath === path.join(targetRepoPath, 'src', 'created.ts'),
    )

    expect(modified).toMatchObject({
      changeType: 'modified',
      originalContent: 'old\n',
      proposedContent: 'old\nnew\n',
      additions: 1,
      deletions: 0,
      status: 'pending',
    })
    expect(created).toMatchObject({
      changeType: 'added',
      originalContent: '',
      proposedContent: 'created\n',
      additions: 1,
      deletions: 0,
      status: 'pending',
    })
  })

  it('keeps deleted files reviewable before the worktree is removed', async () => {
    await fs.rm(path.join(repoPath, 'src', 'existing.ts'))

    const proposals = await buildDiffProposals(repoPath, targetRepoPath)

    expect(proposals).toEqual([
      expect.objectContaining({
        filePath: path.join(targetRepoPath, 'src', 'existing.ts'),
        changeType: 'deleted',
        originalContent: 'old\n',
        proposedContent: '',
        deletions: 1,
      }),
    ])
  })
})

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, encoding: 'utf-8' })
}
