import fs from 'node:fs/promises'
import path from 'node:path'
import type { DiffProposal } from '../../shared/types'
import { execGit } from '../git/utils'

interface ChangedFile {
  relativePath: string
  changeType: 'added' | 'modified' | 'deleted'
}

interface FileSnapshot {
  exists: boolean
  content: string
}

export interface LocalChangeBaseline {
  files: Map<string, FileSnapshot>
}

export async function captureLocalChangeBaseline(
  repoPath: string,
): Promise<LocalChangeBaseline | null> {
  try {
    const { stdout } = await execGit(repoPath, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ])
    const changes = parseStatus(stdout)
    const files = new Map<string, FileSnapshot>()

    await Promise.all(
      changes.map(async ({ relativePath }) => {
        files.set(relativePath, await readWorkingSnapshot(repoPath, relativePath))
      }),
    )

    return { files }
  } catch {
    return null
  }
}

export async function buildLocalDiffProposals(
  repoPath: string,
  baseline: LocalChangeBaseline,
): Promise<DiffProposal[]> {
  const [statusOutput, numstatOutput] = await Promise.all([
    execGit(repoPath, ['status', '--porcelain=v1', '--untracked-files=all']).then(
      (result) => result.stdout,
    ),
    execGit(repoPath, ['diff', '--numstat', '-z', 'HEAD'])
      .then((result) => result.stdout)
      .catch(() => ''),
  ])
  const stats = parseNumstat(numstatOutput)
  const changes = parseStatus(statusOutput)

  const proposals = await Promise.all(
    changes.map(async ({ relativePath, changeType }): Promise<DiffProposal | null> => {
      const baselineSnapshot = baseline.files.get(relativePath)
      const finalSnapshot = await readWorkingSnapshot(repoPath, relativePath)

      if (baselineSnapshot) {
        if (
          baselineSnapshot.exists === finalSnapshot.exists &&
          baselineSnapshot.content === finalSnapshot.content
        ) {
          return null
        }

        const diff = countChangedLines(baselineSnapshot.content, finalSnapshot.content)
        return {
          filePath: path.join(repoPath, relativePath),
          originalContent: baselineSnapshot.content,
          proposedContent: finalSnapshot.content,
          description: `${changeType} ${relativePath}`,
          changeType: changeTypeFromSnapshots(baselineSnapshot, finalSnapshot),
          additions: diff.additions,
          deletions: diff.deletions,
          baseHash: await readBaseHash(repoPath, relativePath),
          status: 'applied',
        }
      }

      const originalContent =
        changeType === 'added' ? '' : await readHeadFile(repoPath, relativePath)
      const proposedContent = finalSnapshot.exists ? finalSnapshot.content : ''
      const fileStat = stats.get(relativePath) ?? countChangedLines(originalContent, proposedContent)

      return {
        filePath: path.join(repoPath, relativePath),
        originalContent,
        proposedContent,
        description: `${changeType} ${relativePath}`,
        changeType,
        additions: fileStat.additions,
        deletions: fileStat.deletions,
        baseHash: await readBaseHash(repoPath, relativePath),
        status: 'applied',
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

function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
  const stats = new Map<string, { additions: number; deletions: number }>()

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

function changeTypeFromSnapshots(
  before: FileSnapshot,
  after: FileSnapshot,
): 'added' | 'modified' | 'deleted' {
  if (!before.exists && after.exists) return 'added'
  if (before.exists && !after.exists) return 'deleted'
  return 'modified'
}

async function readWorkingSnapshot(
  repoPath: string,
  relativePath: string,
): Promise<FileSnapshot> {
  try {
    return {
      exists: true,
      content: await fs.readFile(path.join(repoPath, relativePath), 'utf-8'),
    }
  } catch {
    return { exists: false, content: '' }
  }
}

async function readHeadFile(repoPath: string, relativePath: string): Promise<string> {
  try {
    const { stdout } = await execGit(repoPath, ['show', `HEAD:${relativePath}`])
    return stdout
  } catch {
    return ''
  }
}

async function readBaseHash(
  repoPath: string,
  relativePath: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await execGit(repoPath, ['rev-parse', `HEAD:${relativePath}`])
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

function countChangedLines(
  originalContent: string,
  proposedContent: string,
): { additions: number; deletions: number } {
  const originalLines = splitComparableLines(originalContent)
  const proposedLines = splitComparableLines(proposedContent)

  let prefix = 0
  while (
    prefix < originalLines.length &&
    prefix < proposedLines.length &&
    originalLines[prefix] === proposedLines[prefix]
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix + prefix < originalLines.length &&
    suffix + prefix < proposedLines.length &&
    originalLines[originalLines.length - 1 - suffix] ===
      proposedLines[proposedLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  return {
    additions: Math.max(0, proposedLines.length - prefix - suffix),
    deletions: Math.max(0, originalLines.length - prefix - suffix),
  }
}

function splitComparableLines(content: string): string[] {
  if (!content) return []
  return content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n')
}
