import type { GitCommandResult } from '../../../../shared/types'
import { runGit, runGitOrThrow } from './runGit'

export async function pushCurrentBranch(
  repoPath: string,
  branch: string,
): Promise<GitCommandResult> {
  const normalizedBranch = normalizePushBranch(branch)
  const remote = await resolvePushRemote(repoPath, normalizedBranch)
  return runGit(buildCurrentBranchPushArgs(normalizedBranch, remote), repoPath)
}

export function buildCurrentBranchPushArgs(branch: string, remote: string): string[] {
  const normalizedBranch = normalizePushBranch(branch)
  const normalizedRemote = remote.trim()
  if (!normalizedRemote) {
    throw new Error(`No push remote is configured for branch ${normalizedBranch}.`)
  }

  return [
    'push',
    '--set-upstream',
    normalizedRemote,
    `HEAD:refs/heads/${normalizedBranch}`,
  ]
}

async function resolvePushRemote(repoPath: string, branch: string): Promise<string> {
  const remotes = await listRemotes(repoPath)
  if (remotes.length === 0) {
    throw new Error('No git remote is configured. Add a remote before pushing.')
  }

  const configuredRemotes = await Promise.all([
    readGitConfig(repoPath, `branch.${branch}.pushRemote`),
    readGitConfig(repoPath, 'remote.pushDefault'),
    readGitConfig(repoPath, `branch.${branch}.remote`),
  ])

  for (const remote of configuredRemotes) {
    if (remote && remote !== '.' && remotes.includes(remote)) return remote
  }

  if (remotes.includes('origin')) return 'origin'
  if (remotes.length === 1) return remotes[0]

  throw new Error(
    `No push remote is configured for branch ${branch}. Set remote.pushDefault or branch.${branch}.pushRemote.`,
  )
}

function normalizePushBranch(branch: string): string {
  const normalizedBranch = branch.trim()
  if (normalizedBranch && normalizedBranch !== 'HEAD') return normalizedBranch

  throw new Error(
    'Commit & Push requires a named branch. Create or switch to a branch before pushing.',
  )
}

async function listRemotes(repoPath: string): Promise<string[]> {
  const result = await runGitOrThrow(['remote'], repoPath)
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

async function readGitConfig(repoPath: string, key: string): Promise<string | null> {
  const result = await runGit(['config', '--get', key], repoPath)
  if (result.exitCode !== 0) return null

  const value = result.stdout.trim()
  return value || null
}
