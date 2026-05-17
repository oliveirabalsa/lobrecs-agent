import fs from 'node:fs/promises'
import path from 'node:path'
import type { DiffProposal } from '../../shared/types'
import { execGit } from '../git/utils'

interface DiffStat {
  additions: number
  deletions: number
}

export async function buildDiffProposals(
  worktreePath: string,
  targetRepoPath: string,
): Promise<DiffProposal[]> {
  const [nameStatusOutput, numstatOutput] = await Promise.all([
    execGit(worktreePath, ['diff', '--name-status', 'HEAD']).then((result) => result.stdout),
    execGit(worktreePath, ['diff', '--numstat', 'HEAD']).then((result) => result.stdout),
  ])
  const stats = parseNumstat(numstatOutput)
  const changes = nameStatusOutput
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const proposals = await Promise.all(
    changes.map(async (line): Promise<DiffProposal | null> => {
      const [status, ...pathParts] = line.split(/\s+/)
      const relativePath = pathParts.at(-1)
      if (!relativePath) return null

      const changeType = changeTypeFromStatus(status)
      const originalContent =
        changeType === 'added' ? '' : await readHeadFile(worktreePath, relativePath)
      const proposedContent =
        changeType === 'deleted' ? '' : await readWorkingFile(worktreePath, relativePath)
      const fileStat = stats.get(relativePath)

      return {
        filePath: path.join(targetRepoPath, relativePath),
        originalContent,
        proposedContent,
        description: `${changeType} ${relativePath}`,
        changeType,
        additions: fileStat?.additions ?? countLines(proposedContent),
        deletions: fileStat?.deletions ?? countLines(originalContent),
        baseHash: await readBaseHash(worktreePath, relativePath),
        status: 'pending',
      }
    }),
  )

  return proposals.filter((proposal): proposal is DiffProposal => proposal !== null)
}

function parseNumstat(output: string): Map<string, DiffStat> {
  const stats = new Map<string, DiffStat>()

  for (const line of output.trim().split('\n')) {
    const [added, deleted, ...pathParts] = line.trim().split(/\s+/)
    const relativePath = pathParts.at(-1)
    if (!relativePath) continue

    stats.set(relativePath, {
      additions: parseGitCount(added),
      deletions: parseGitCount(deleted),
    })
  }

  return stats
}

function changeTypeFromStatus(status: string | undefined): 'added' | 'modified' | 'deleted' {
  if (status?.startsWith('A')) return 'added'
  if (status?.startsWith('D')) return 'deleted'
  return 'modified'
}

async function readHeadFile(worktreePath: string, relativePath: string): Promise<string> {
  try {
    const { stdout } = await execGit(worktreePath, ['show', `HEAD:${relativePath}`])
    return stdout
  } catch {
    return ''
  }
}

async function readWorkingFile(worktreePath: string, relativePath: string): Promise<string> {
  try {
    return await fs.readFile(path.join(worktreePath, relativePath), 'utf-8')
  } catch {
    return ''
  }
}

async function readBaseHash(
  worktreePath: string,
  relativePath: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await execGit(worktreePath, ['rev-parse', `HEAD:${relativePath}`])
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

function parseGitCount(value: string | undefined): number {
  if (!value || value === '-') return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function countLines(content: string): number {
  if (!content) return 0
  return content.split('\n').filter(Boolean).length
}
