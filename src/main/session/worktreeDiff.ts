import fs from 'node:fs/promises'
import path from 'node:path'
import type { DiffProposal } from '../../shared/types'
import { execGit } from '../git/utils'

interface DiffStat {
  additions: number
  deletions: number
}

interface ChangedFile {
  relativePath: string
  changeType: 'added' | 'modified' | 'deleted'
}

export async function buildDiffProposals(
  worktreePath: string,
  targetRepoPath: string,
): Promise<DiffProposal[]> {
  const [statusOutput, numstatOutput] = await Promise.all([
    execGit(worktreePath, ['status', '--porcelain=v1', '--untracked-files=all']).then(
      (result) => result.stdout,
    ),
    execGit(worktreePath, ['diff', '--numstat', '-z', 'HEAD']).then((result) => result.stdout),
  ])
  const stats = parseNumstat(numstatOutput)
  const changes = parseStatus(statusOutput)

  const proposals = await Promise.all(
    changes.map(async ({ relativePath, changeType }): Promise<DiffProposal | null> => {
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

function parseStatus(output: string): ChangedFile[] {
  const seen = new Set<string>()
  const changes: ChangedFile[] = []

  for (const line of output.split('\n')) {
    if (!line.trim()) continue

    const status = line.slice(0, 2)
    const relativePath = normalizeStatusPath(line.slice(3))
    if (!relativePath || seen.has(relativePath)) continue

    seen.add(relativePath)
    changes.push({
      relativePath,
      changeType: changeTypeFromStatus(status),
    })
  }

  return changes
}

function parseNumstat(output: string): Map<string, DiffStat> {
  const stats = new Map<string, DiffStat>()

  for (const record of output.split('\0')) {
    if (!record.trim()) continue

    const [added, deleted, relativePath] = record.split('\t')
    if (!relativePath) continue

    stats.set(relativePath, {
      additions: parseGitCount(added),
      deletions: parseGitCount(deleted),
    })
  }

  return stats
}

function normalizeStatusPath(value: string): string {
  const rawPath = value.includes(' -> ') ? value.slice(value.lastIndexOf(' -> ') + 4) : value
  return unquoteGitPath(rawPath.trim())
}

function unquoteGitPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value

  try {
    return JSON.parse(value) as string
  } catch {
    return value.slice(1, -1)
  }
}

function changeTypeFromStatus(status: string | undefined): 'added' | 'modified' | 'deleted' {
  if (status?.includes('?') || status?.includes('A')) return 'added'
  if (status?.includes('D')) return 'deleted'
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
