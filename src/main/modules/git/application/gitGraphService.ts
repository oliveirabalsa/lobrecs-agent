import type {
  GitBranchMergeStatus,
  GitBranchNode,
  GitGraphCommit,
  GitGraphData,
} from '../../../../shared/types'
import type { WorktreeManager } from '../../../git/WorktreeManager'
import { runGit, runGitOrThrow } from '../infrastructure/runGit'

const MAX_BRANCHES = 20
const RECENT_COMMIT_LIMIT = 5
const DEFAULT_BRANCH_FALLBACK = 'main'

interface WorktreeIndexEntry {
  sessionId: string
  worktreePath: string
}

export async function buildGitGraphData(
  projectId: string,
  repoPath: string,
  worktreeManager: WorktreeManager,
): Promise<GitGraphData> {
  const defaultBranch = await resolveDefaultBranch(repoPath)
  const localBranches = await listLocalBranches(repoPath)
  const worktreeIndex = indexWorktrees(worktreeManager)

  const nodes = await Promise.all(
    localBranches.map((branch) =>
      buildBranchNode(branch, repoPath, defaultBranch, worktreeIndex),
    ),
  )

  const filtered = filterAndCapNodes(nodes)

  return {
    projectId,
    defaultBranch,
    capturedAt: new Date().toISOString(),
    nodes: filtered,
  }
}

async function resolveDefaultBranch(repoPath: string): Promise<string> {
  const remoteHead = await runGit(
    ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
    repoPath,
  )
  if (remoteHead.exitCode === 0) {
    const value = remoteHead.stdout.trim()
    if (value.startsWith('origin/')) return value.slice('origin/'.length)
    if (value) return value
  }

  for (const candidate of ['main', 'master']) {
    const exists = await runGit(
      ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`],
      repoPath,
    )
    if (exists.exitCode === 0) return candidate
  }

  return DEFAULT_BRANCH_FALLBACK
}

async function listLocalBranches(repoPath: string): Promise<string[]> {
  const result = await runGitOrThrow(
    ['branch', '--format=%(refname:short)'],
    repoPath,
  )
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('('))
}

function indexWorktrees(worktreeManager: WorktreeManager): Map<string, WorktreeIndexEntry> {
  const index = new Map<string, WorktreeIndexEntry>()
  for (const entry of worktreeManager.list()) {
    index.set(entry.branch, {
      sessionId: entry.sessionId,
      worktreePath: entry.worktreePath,
    })
  }
  return index
}

async function buildBranchNode(
  branch: string,
  repoPath: string,
  defaultBranch: string,
  worktreeIndex: Map<string, WorktreeIndexEntry>,
): Promise<GitBranchNode> {
  const isDefault = branch === defaultBranch
  const compareRef = isDefault ? null : defaultBranch

  const [
    headSha,
    baseCommitSha,
    aheadCount,
    behindCount,
    dirtyFileCount,
    firstCommitDate,
    recentCommits,
  ] = await Promise.all([
    readHeadSha(repoPath, branch),
    compareRef ? readMergeBase(repoPath, compareRef, branch) : readHeadSha(repoPath, branch),
    compareRef ? readRevCount(repoPath, `${compareRef}..${branch}`) : Promise.resolve(0),
    compareRef ? readRevCount(repoPath, `${branch}..${compareRef}`) : Promise.resolve(0),
    readDirtyFileCount(repoPath, branch, worktreeIndex),
    compareRef
      ? readFirstCommitDate(repoPath, compareRef, branch)
      : readHeadCommitDate(repoPath, branch),
    compareRef
      ? readRecentCommits(repoPath, branch, compareRef)
      : readRecentCommitsAll(repoPath, branch),
  ])

  const mergeStatus: GitBranchMergeStatus = isDefault
    ? 'clean'
    : deriveMergeStatus(aheadCount, behindCount)

  const worktree = worktreeIndex.get(branch)

  return {
    branch,
    isDefault,
    headSha,
    baseCommitSha,
    aheadCount,
    behindCount,
    dirtyFileCount,
    firstCommitDate,
    mergeStatus,
    recentCommits,
    sessionId: worktree?.sessionId,
    worktreePath: worktree?.worktreePath,
  }
}

function deriveMergeStatus(aheadCount: number, behindCount: number): GitBranchMergeStatus {
  if (aheadCount === 0 && behindCount === 0) return 'clean'
  if (aheadCount > 0 && behindCount === 0) return 'ahead-only'
  if (aheadCount === 0 && behindCount > 0) return 'behind'
  return 'diverged'
}

async function readHeadSha(repoPath: string, branch: string): Promise<string> {
  const result = await runGit(['rev-parse', branch], repoPath)
  return result.exitCode === 0 ? result.stdout.trim() : ''
}

async function readMergeBase(
  repoPath: string,
  defaultBranch: string,
  branch: string,
): Promise<string> {
  const result = await runGit(['merge-base', defaultBranch, branch], repoPath)
  return result.exitCode === 0 ? result.stdout.trim() : ''
}

async function readRevCount(repoPath: string, range: string): Promise<number> {
  const result = await runGit(['rev-list', '--count', range], repoPath)
  if (result.exitCode !== 0) return 0
  const parsed = Number.parseInt(result.stdout.trim(), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

async function readDirtyFileCount(
  repoPath: string,
  branch: string,
  worktreeIndex: Map<string, WorktreeIndexEntry>,
): Promise<number> {
  const worktree = worktreeIndex.get(branch)
  const targetPath = worktree?.worktreePath ?? repoPath

  const result = await runGit(['status', '--porcelain'], targetPath)
  if (result.exitCode !== 0) return 0
  return result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0).length
}

async function readFirstCommitDate(
  repoPath: string,
  defaultBranch: string,
  branch: string,
): Promise<string> {
  const result = await runGit(
    ['log', '--format=%aI', '--reverse', `${defaultBranch}..${branch}`],
    repoPath,
  )
  if (result.exitCode !== 0) return ''
  const firstLine = result.stdout.split(/\r?\n/).find((line) => line.trim().length > 0)
  return firstLine?.trim() ?? ''
}

async function readHeadCommitDate(repoPath: string, branch: string): Promise<string> {
  const result = await runGit(['log', '-1', '--format=%aI', branch], repoPath)
  return result.exitCode === 0 ? result.stdout.trim() : ''
}

async function readRecentCommits(
  repoPath: string,
  branch: string,
  defaultBranch: string,
): Promise<GitGraphCommit[]> {
  const result = await runGit(
    [
      'log',
      `--max-count=${RECENT_COMMIT_LIMIT}`,
      '--format=%H%x09%h%x09%s%x09%an%x09%aI',
      branch,
      '--not',
      defaultBranch,
    ],
    repoPath,
  )
  if (result.exitCode !== 0) return []
  return parseCommitLog(result.stdout)
}

async function readRecentCommitsAll(repoPath: string, branch: string): Promise<GitGraphCommit[]> {
  const result = await runGit(
    [
      'log',
      `--max-count=${RECENT_COMMIT_LIMIT}`,
      '--format=%H%x09%h%x09%s%x09%an%x09%aI',
      branch,
    ],
    repoPath,
  )
  if (result.exitCode !== 0) return []
  return parseCommitLog(result.stdout)
}

function parseCommitLog(stdout: string): GitGraphCommit[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha, shortSha, message, author, date] = line.split('\t')
      return {
        sha: sha ?? '',
        shortSha: shortSha ?? '',
        message: message ?? '',
        author: author ?? '',
        date: date ?? '',
      }
    })
}

function filterAndCapNodes(nodes: GitBranchNode[]): GitBranchNode[] {
  const kept = nodes.filter((node) => {
    if (node.isDefault) return true
    if (node.sessionId) return true
    return node.aheadCount > 0 || node.behindCount > 0
  })

  kept.sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1
    const leftSession = left.sessionId ? 1 : 0
    const rightSession = right.sessionId ? 1 : 0
    if (leftSession !== rightSession) return rightSession - leftSession
    return (right.firstCommitDate ?? '').localeCompare(left.firstCommitDate ?? '')
  })

  return kept.slice(0, MAX_BRANCHES)
}
