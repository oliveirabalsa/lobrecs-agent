import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface GitDiffStats {
  filesChanged: number
  additions: number
  deletions: number
  summary: string
}

export async function execGit(
  repoPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd: repoPath,
    encoding: 'utf-8',
    maxBuffer: 20 * 1024 * 1024,
  })

  return { stdout, stderr }
}

export async function createPatch(worktreePath: string): Promise<string> {
  const { stdout } = await execGit(worktreePath, ['diff', 'HEAD'])
  return stdout
}

export async function applyPatch(targetRepoPath: string, patch: string): Promise<void> {
  await spawnGitWithInput(targetRepoPath, ['apply', '--index', '-'], patch)
}

export async function getDiffStats(worktreePath: string): Promise<GitDiffStats> {
  const { stdout } = await execGit(worktreePath, ['diff', '--numstat', 'HEAD'])
  const rows = stdout
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  let additions = 0
  let deletions = 0

  for (const row of rows) {
    const [added, deleted] = row.split(/\s+/)
    additions += parseGitCount(added)
    deletions += parseGitCount(deleted)
  }

  const filesChanged = rows.length

  return {
    filesChanged,
    additions,
    deletions,
    summary: `${additions > 0 ? `+${additions}` : '+0'} -${deletions} lines, ${filesChanged} ${
      filesChanged === 1 ? 'file' : 'files'
    } changed`,
  }
}

function parseGitCount(value: string | undefined): number {
  if (!value || value === '-') return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function spawnGitWithInput(cwd: string, args: string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const stderr: Buffer[] = []

    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(Buffer.concat(stderr).toString('utf-8').trim() || `git exited ${code}`))
    })

    child.stdin.end(input)
  })
}
