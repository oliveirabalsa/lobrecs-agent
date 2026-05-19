import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildLocalDiffProposals, captureLocalChangeBaseline } from './localDiff'

const execFileAsync = promisify(execFile)

describe('localDiff', () => {
  let repoPath: string

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobrecs-agent-local-diff-'))

    await git(repoPath, ['init'])
    await git(repoPath, ['config', 'user.email', 'agent@example.test'])
    await git(repoPath, ['config', 'user.name', 'Agent Test'])
    await fs.mkdir(path.join(repoPath, 'src'), { recursive: true })
    await fs.writeFile(path.join(repoPath, 'src', 'existing.ts'), 'original\n', 'utf-8')
    await fs.writeFile(path.join(repoPath, 'src', 'dirty.ts'), 'committed\n', 'utf-8')
    await git(repoPath, ['add', '.'])
    await git(repoPath, ['commit', '-m', 'initial commit'])
  })

  afterEach(async () => {
    await fs.rm(repoPath, { recursive: true, force: true })
  })

  it('reports local edits made after the baseline and ignores pre-existing dirty files', async () => {
    await fs.writeFile(path.join(repoPath, 'src', 'dirty.ts'), 'dirty before\n', 'utf-8')
    const baseline = await captureLocalChangeBaseline(repoPath)

    await fs.writeFile(path.join(repoPath, 'src', 'existing.ts'), 'updated\n', 'utf-8')
    await fs.writeFile(path.join(repoPath, 'src', 'created.ts'), 'created\n', 'utf-8')

    expect(baseline).not.toBeNull()
    const proposals = await buildLocalDiffProposals(repoPath, baseline!)

    expect(proposals.map((proposal) => path.relative(repoPath, proposal.filePath)).sort()).toEqual([
      'src/created.ts',
      'src/existing.ts',
    ])
    expect(proposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: path.join(repoPath, 'src', 'existing.ts'),
          originalContent: 'original\n',
          proposedContent: 'updated\n',
          changeType: 'modified',
          status: 'applied',
        }),
        expect.objectContaining({
          filePath: path.join(repoPath, 'src', 'created.ts'),
          originalContent: '',
          proposedContent: 'created\n',
          changeType: 'added',
          status: 'applied',
        }),
      ]),
    )
  })

  it('reports pre-existing dirty files when the agent changes them further', async () => {
    await fs.writeFile(path.join(repoPath, 'src', 'dirty.ts'), 'dirty before\n', 'utf-8')
    const baseline = await captureLocalChangeBaseline(repoPath)

    await fs.writeFile(path.join(repoPath, 'src', 'dirty.ts'), 'dirty after\n', 'utf-8')

    expect(baseline).not.toBeNull()
    const proposals = await buildLocalDiffProposals(repoPath, baseline!)

    expect(proposals).toEqual([
      expect.objectContaining({
        filePath: path.join(repoPath, 'src', 'dirty.ts'),
        originalContent: 'dirty before\n',
        proposedContent: 'dirty after\n',
        changeType: 'modified',
        status: 'applied',
      }),
    ])
  })

  it('returns null for paths that are not git repositories', async () => {
    const outsideRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'lobrecs-agent-no-git-'))

    try {
      await expect(captureLocalChangeBaseline(outsideRepo)).resolves.toBeNull()
    } finally {
      await fs.rm(outsideRepo, { recursive: true, force: true })
    }
  })
})

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, encoding: 'utf-8' })
}
