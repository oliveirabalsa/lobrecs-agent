import type {
  GitBranchActionInput,
  GitCommitDetailRequest,
  GitCommitInput,
  GitFileActionInput,
  GitFileDiffRequest,
  GitOperationResult,
  GitRepositorySnapshot,
  GitSnapshotRequest,
  GitStashActionInput,
  GitStashDetailRequest,
} from '../../../../shared/contracts/git'
import { runGit, runGitOrThrow } from '../infrastructure/runGit'
import { pushCurrentBranch } from '../infrastructure/pushCurrentBranch'
import {
  parseBranchList,
  parseCommitGraph,
  parseRemotes,
  parseStashList,
  parseStatusPorcelain,
} from '../domain/gitWorkspaceParsers'

const DEFAULT_COMMIT_LIMIT = 80
const MAX_COMMIT_LIMIT = 300

export class GitWorkspaceService {
  async getSnapshot(
    repoPath: string,
    request: GitSnapshotRequest,
  ): Promise<GitRepositorySnapshot> {
    const commitLimit = clampCommitLimit(request.commitLimit)
    const [status, branches, commits, stash, remotes] = await Promise.all([
      runGitOrThrow(['status', '--porcelain=v1', '-b', '--untracked-files=all'], repoPath),
      runGitOrThrow(
        [
          'branch',
          '--format=%(HEAD)\t%(refname:short)\t%(upstream:short)\t%(objectname:short)\t%(committerdate:iso8601)\t%(subject)\t%(upstream:track)',
        ],
        repoPath,
      ),
      runGit(
        [
          'log',
          '--graph',
          `--max-count=${commitLimit}`,
          '--date=iso',
          '--format=%H%x09%h%x09%s%x09%an%x09%aI%x09%D',
        ],
        repoPath,
      ),
      runGit(['stash', 'list', '--format=%gd%x09%H%x09%cr%x09%gs'], repoPath),
      runGit(['remote', '-v'], repoPath),
    ])
    const parsedStatus = parseStatusPorcelain(status.stdout)

    return {
      projectId: request.projectId,
      repoPath,
      branch: parsedStatus.branch,
      files: parsedStatus.files,
      branches: parseBranchList(branches.stdout),
      commits: commits.exitCode === 0 ? parseCommitGraph(commits.stdout) : [],
      stash: stash.exitCode === 0 ? parseStashList(stash.stdout) : [],
      remotes: remotes.exitCode === 0 ? parseRemotes(remotes.stdout) : [],
      capturedAt: new Date().toISOString(),
    }
  }

  async getFileDiff(repoPath: string, request: GitFileDiffRequest): Promise<GitOperationResult> {
    const path = validatePath(request.path)
    const unstaged = await runGit(['diff', '--', path], repoPath)
    if (unstaged.exitCode !== 0 || unstaged.stdout.trim()) {
      return toOperationResult('file-diff', unstaged, 'Loaded file diff.')
    }

    const staged = await runGit(['diff', '--cached', '--', path], repoPath)
    return toOperationResult('file-diff', staged, 'Loaded staged file diff.')
  }

  async getCommitDetail(
    repoPath: string,
    request: GitCommitDetailRequest,
  ): Promise<GitOperationResult> {
    const sha = validateRevision(request.sha ?? request.hash, 'Commit SHA')
    return toOperationResult(
      'commit-detail',
      await runGit(['show', '--stat', '--patch', '--find-renames', '--format=fuller', sha], repoPath),
      'Loaded commit detail.',
    )
  }

  async getStashDetail(repoPath: string, request: GitStashDetailRequest): Promise<GitOperationResult> {
    const ref = validateStashRef(request.ref ?? request.stashId)
    return toOperationResult(
      'stash-detail',
      await runGit(['stash', 'show', '--patch', ref], repoPath),
      'Loaded stash detail.',
    )
  }

  async stageFile(repoPath: string, input: GitFileActionInput): Promise<GitOperationResult> {
    const path = validatePath(input.path)
    return toOperationResult('stage-file', await runGit(['add', '--', path], repoPath), 'Staged file.')
  }

  async unstageFile(repoPath: string, input: GitFileActionInput): Promise<GitOperationResult> {
    const path = validatePath(input.path)
    return toOperationResult(
      'unstage-file',
      await runGit(['restore', '--staged', '--', path], repoPath),
      'Unstaged file.',
    )
  }

  async stageAll(repoPath: string): Promise<GitOperationResult> {
    return toOperationResult('stage-all', await runGit(['add', '--all'], repoPath), 'Staged all changes.')
  }

  async checkoutBranch(
    repoPath: string,
    input: GitBranchActionInput,
  ): Promise<GitOperationResult> {
    const branchName = await validateBranchName(input.branchName, repoPath)
    return toOperationResult(
      'checkout-branch',
      await runGit(['switch', branchName], repoPath),
      `Checked out ${branchName}.`,
    )
  }

  async fetch(repoPath: string): Promise<GitOperationResult> {
    return toOperationResult('fetch', await runGit(['fetch'], repoPath), 'Fetched remote refs.')
  }

  async pull(repoPath: string): Promise<GitOperationResult> {
    return toOperationResult('pull', await runGit(['pull'], repoPath), 'Pulled current branch.')
  }

  async push(repoPath: string): Promise<GitOperationResult> {
    const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)
    if (branch.exitCode !== 0) {
      return toOperationResult('push', branch, 'Unable to resolve current branch.')
    }

    const branchName = branch.stdout.trim()
    if (!branchName || branchName === 'HEAD') {
      return confirmationResult('push', 'Push requires a named current branch.')
    }

    return toOperationResult(
      'push',
      await pushCurrentBranch(repoPath, branchName),
      `Pushed ${branchName}.`,
    )
  }

  async commit(repoPath: string, input: GitCommitInput): Promise<GitOperationResult> {
    const message = input.message.trim()
    if (!message) {
      return confirmationResult('commit', 'Commit message is required.')
    }

    return toOperationResult(
      'commit',
      await runGit(['commit', '-m', message], repoPath),
      'Created commit.',
    )
  }

  async unstageAll(repoPath: string): Promise<GitOperationResult> {
    return toOperationResult('unstage-all', await runGit(['restore', '--staged', '.'], repoPath), 'Unstaged all changes.')
  }

  async deleteBranch(repoPath: string, input: GitBranchActionInput): Promise<GitOperationResult> {
    const branchName = await validateBranchName(input.branchName, repoPath)
    return toOperationResult(
      'delete-branch',
      await runGit(['branch', '-d', branchName], repoPath),
      `Deleted branch ${branchName}.`,
    )
  }

  async discardFile(repoPath: string, input: GitFileActionInput): Promise<GitOperationResult> {
    const path = validatePath(input.path)
    return toOperationResult(
      'discard-file',
      await runGit(['checkout', '--', path], repoPath),
      `Discarded changes in ${path}.`,
    )
  }

  async applyStash(repoPath: string, input: GitStashActionInput): Promise<GitOperationResult> {
    const ref = validateStashRef(input.ref ?? input.stashId)
    return toOperationResult(
      'apply-stash',
      await runGit(['stash', 'apply', ref], repoPath),
      `Applied ${ref}.`,
    )
  }

  async popStash(repoPath: string, input: GitStashActionInput): Promise<GitOperationResult> {
    const ref = validateStashRef(input.ref ?? input.stashId)
    if (!input.confirmed) {
      return confirmationResult('pop-stash', `Popping ${ref} removes it from the stash if apply succeeds.`)
    }

    return toOperationResult('pop-stash', await runGit(['stash', 'pop', ref], repoPath), `Popped ${ref}.`)
  }

  async dropStash(repoPath: string, input: GitStashActionInput): Promise<GitOperationResult> {
    const ref = validateStashRef(input.ref ?? input.stashId)
    if (!input.confirmed) {
      return confirmationResult('drop-stash', `Dropping ${ref} permanently removes that stash entry.`)
    }

    return toOperationResult(
      'drop-stash',
      await runGit(['stash', 'drop', ref], repoPath),
      `Dropped ${ref}.`,
    )
  }
}

export async function validateBranchName(branchName: string, repoPath: string): Promise<string> {
  const name = branchName.trim()
  if (!name) {
    throw new Error('Branch name is required.')
  }

  const result = await runGit(['check-ref-format', '--branch', name], repoPath)
  if (result.exitCode === 0) return name

  throw new Error(result.stderr.trim() || result.stdout.trim() || 'Invalid branch name.')
}

function clampCommitLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_COMMIT_LIMIT
  return Math.min(Math.max(Math.trunc(value ?? DEFAULT_COMMIT_LIMIT), 1), MAX_COMMIT_LIMIT)
}

function validatePath(path: string | undefined): string {
  const normalized = path?.trim() ?? ''
  if (!normalized || normalized.includes('\0')) {
    throw new Error('A valid file path is required.')
  }
  return normalized
}

function validateRevision(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? ''
  if (!/^[a-f0-9]{7,40}$/i.test(normalized)) {
    throw new Error(`${label} is invalid.`)
  }
  return normalized
}

function validateStashRef(ref: string | undefined): string {
  const normalized = ref?.trim() ?? ''
  if (!/^stash@\{\d+\}$/.test(normalized)) {
    throw new Error('Stash ref must look like stash@{0}.')
  }
  return normalized
}

function toOperationResult(
  kind: string,
  result: { exitCode: number; stdout: string; stderr: string },
  successMessage: string,
): GitOperationResult {
  const message =
    result.exitCode === 0
      ? successMessage
      : result.stderr.trim() || result.stdout.trim() || `Git ${kind} failed.`

  return {
    ...result,
    ok: result.exitCode === 0,
    message,
  }
}

function confirmationResult(kind: string, message: string): GitOperationResult {
  return {
    exitCode: 1,
    stdout: '',
    stderr: message,
    ok: false,
    message,
    requiresConfirmation: true,
  }
}
