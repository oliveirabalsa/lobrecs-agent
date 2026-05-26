import { spawn } from 'node:child_process'
import https from 'node:https'
import type {
  CreatePullRequestInput,
  CreatePullRequestResult,
  GitChangedFile,
  GitFileChangeStatus,
  GitRemoteInfo,
  PullRequestDiffSnapshot,
} from '../../../../shared/types'
import { buildProcessEnvironment } from '../../../process/environment'
import { buildGhPrCreateArgs, resolveGhCommand } from './githubCli'

// git@github.com:owner/repo.git  and  git@github.com:owner/repo
const GITHUB_SSH_RE = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/

// https://github.com/owner/repo.git  and  https://TOKEN@github.com/owner/repo
const GITHUB_HTTPS_RE = /^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?(?:\/.*)?$/

export class GitHubPrProvider {
  readonly type = 'github' as const

  detectFromRemote(remoteUrl: string): GitRemoteInfo | null {
    const sshMatch = GITHUB_SSH_RE.exec(remoteUrl)
    if (sshMatch) {
      return { url: remoteUrl, provider: 'github', owner: sshMatch[1]!, repo: sshMatch[2]! }
    }

    const httpsMatch = GITHUB_HTTPS_RE.exec(remoteUrl)
    if (httpsMatch) {
      return { url: remoteUrl, provider: 'github', owner: httpsMatch[1]!, repo: httpsMatch[2]! }
    }

    return null
  }

  async createPullRequest(
    repoPath: string,
    remoteInfo: GitRemoteInfo,
    input: Omit<CreatePullRequestInput, 'projectId'>,
  ): Promise<CreatePullRequestResult> {
    const ghResult = await tryGhCli(repoPath, input)
    if (ghResult !== null) return ghResult

    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
    if (token) return callGitHubApi(remoteInfo, input, token)

    throw new Error(
      'GitHub authentication required. Run `gh auth login` or set the GITHUB_TOKEN environment variable.',
    )
  }

  async fetchPullRequestDiff(
    repoPath: string,
    remoteInfo: GitRemoteInfo,
    prNumber: number,
  ): Promise<PullRequestDiffSnapshot> {
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      throw new Error(`Invalid pull request number: ${prNumber}`)
    }

    const ghSnapshot = await tryGhFetchPullRequest(repoPath, prNumber).catch(() => null)
    if (ghSnapshot) return ghSnapshot

    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
    if (token) return fetchPullRequestViaApi(remoteInfo, prNumber, token)

    throw new Error(
      'GitHub authentication required to fetch the pull request. Run `gh auth login` or set GITHUB_TOKEN.',
    )
  }
}

export function normalizePullRequestSnapshot(input: {
  prNumber: number
  url: string
  title: string
  state: PullRequestDiffSnapshot['state']
  baseBranch: string
  headBranch: string
  baseSha: string
  headSha: string
  repoSlug: string
  files: Array<{ filename: string; previous_filename?: string; status?: string; patch?: string }>
}): PullRequestDiffSnapshot {
  const changedFiles: GitChangedFile[] = input.files.map((file) => ({
    path: file.filename,
    previousPath: file.previous_filename,
    status: mapGitHubFileStatus(file.status),
  }))

  const patchParts: string[] = []
  const diffStatRows: Array<{ path: string; additions: number; deletions: number }> = []
  let totalAdditions = 0
  let totalDeletions = 0

  for (const file of input.files) {
    if (!file.patch) continue

    const previous = file.previous_filename ?? file.filename
    patchParts.push(
      `diff --git a/${previous} b/${file.filename}`,
      `--- a/${previous}`,
      `+++ b/${file.filename}`,
      file.patch.trimEnd(),
    )

    const { additions, deletions } = countDiffStat(file.patch)
    totalAdditions += additions
    totalDeletions += deletions
    diffStatRows.push({ path: file.filename, additions, deletions })
  }

  const diffStat = diffStatRows.length === 0
    ? ''
    : [
        ...diffStatRows.map((row) => ` ${row.path} | ${row.additions + row.deletions} ${'+'.repeat(Math.min(row.additions, 10))}${'-'.repeat(Math.min(row.deletions, 10))}`),
        ` ${diffStatRows.length} file${diffStatRows.length === 1 ? '' : 's'} changed, ${totalAdditions} insertion${totalAdditions === 1 ? '' : 's'}(+), ${totalDeletions} deletion${totalDeletions === 1 ? '' : 's'}(-)`,
      ].join('\n')

  return {
    prNumber: input.prNumber,
    url: input.url,
    title: input.title,
    state: input.state,
    baseBranch: input.baseBranch,
    headBranch: input.headBranch,
    baseSha: input.baseSha,
    headSha: input.headSha,
    repoSlug: input.repoSlug,
    changedFiles,
    patch: patchParts.join('\n'),
    diffStat,
  }
}

function mapGitHubFileStatus(status: string | undefined): GitFileChangeStatus {
  switch (status) {
    case 'added':
      return 'added'
    case 'removed':
      return 'deleted'
    case 'renamed':
      return 'renamed'
    case 'copied':
      return 'copied'
    case 'changed':
    case 'modified':
      return 'modified'
    default:
      return 'modified'
  }
}

function countDiffStat(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
  }
  return { additions, deletions }
}

// Spawns `gh pr create` with args passed as an array — no shell, no injection risk.
// Returns null only when gh is not installed or auth fails; throws on real gh errors.
async function tryGhCli(
  repoPath: string,
  input: Omit<CreatePullRequestInput, 'projectId'>,
): Promise<CreatePullRequestResult | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      resolveGhCommand(),
      buildGhPrCreateArgs(input),
      { cwd: repoPath, env: buildProcessEnvironment(), stdio: 'pipe' },
    )

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') resolve(null) // gh not installed — fall through to REST API
      else reject(err)
    })

    child.on('exit', (code) => {
      if (code !== 0) {
        const errorText = stderr.trim() || stdout.trim()
        // Auth failures: fall through to GITHUB_TOKEN REST API
        if (
          errorText.includes('not logged') ||
          errorText.includes('auth login') ||
          errorText.includes('401')
        ) {
          resolve(null)
          return
        }
        reject(new Error(errorText || 'gh pr create failed'))
        return
      }

      // gh pr create prints the PR URL as the last line on success
      const url = stdout.trim().split('\n').pop()?.trim() ?? ''
      if (!url.startsWith('http')) {
        resolve(null)
        return
      }

      const match = /\/pull\/(\d+)$/.exec(url)
      resolve(match ? { url, number: parseInt(match[1]!, 10) } : null)
    })

    child.stdin.end()
  })
}

function callGitHubApi(
  remoteInfo: GitRemoteInfo,
  input: Omit<CreatePullRequestInput, 'projectId'>,
  token: string,
): Promise<CreatePullRequestResult> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      title: input.title,
      body: input.body,
      head: input.headBranch,
      base: input.baseBranch,
    })

    const options: https.RequestOptions = {
      hostname: 'api.github.com',
      path: `/repos/${remoteInfo.owner}/${remoteInfo.repo}/pulls`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${token}`,
        'User-Agent': 'lobrecs-agent',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        if (res.statusCode !== 201) {
          try {
            const parsed = JSON.parse(data) as { message?: string }
            reject(new Error(parsed.message ?? `GitHub API error: ${res.statusCode}`))
          } catch {
            reject(new Error(`GitHub API error: ${res.statusCode}`))
          }
          return
        }

        try {
          const parsed = JSON.parse(data) as { html_url: string; number: number }
          resolve({ url: parsed.html_url, number: parsed.number })
        } catch {
          reject(new Error('Failed to parse GitHub API response'))
        }
      })
    })

    req.on('error', (err: Error) => reject(new Error(`GitHub API request failed: ${err.message}`)))
    req.write(body)
    req.end()
  })
}

async function tryGhFetchPullRequest(
  repoPath: string,
  prNumber: number,
): Promise<PullRequestDiffSnapshot | null> {
  const prMeta = await runGhCapture(repoPath, [
    'pr',
    'view',
    String(prNumber),
    '--json',
    'number,url,title,state,baseRefName,headRefName,baseRefOid,headRefOid,isCrossRepository,headRepository,headRepositoryOwner,merged',
  ])
  if (!prMeta) return null

  let meta: Record<string, unknown>
  try {
    meta = JSON.parse(prMeta) as Record<string, unknown>
  } catch {
    return null
  }

  const repoInfo = await runGhCapture(repoPath, ['repo', 'view', '--json', 'owner,name'])
  if (!repoInfo) return null

  let repoSlug: string
  try {
    const repoParsed = JSON.parse(repoInfo) as { owner?: { login?: string }; name?: string }
    if (!repoParsed.owner?.login || !repoParsed.name) return null
    repoSlug = `${repoParsed.owner.login}/${repoParsed.name}`
  } catch {
    return null
  }

  const filesJson = await runGhCapture(repoPath, [
    'api',
    `repos/${repoSlug}/pulls/${prNumber}/files`,
    '--paginate',
  ])
  if (!filesJson) return null

  let files: Array<{ filename: string; previous_filename?: string; status?: string; patch?: string }>
  try {
    files = JSON.parse(filesJson) as typeof files
    if (!Array.isArray(files)) return null
  } catch {
    return null
  }

  return normalizePullRequestSnapshot({
    prNumber,
    url: typeof meta.url === 'string' ? meta.url : `https://github.com/${repoSlug}/pull/${prNumber}`,
    title: typeof meta.title === 'string' ? meta.title : `Pull request #${prNumber}`,
    state: derivePrState(meta),
    baseBranch: typeof meta.baseRefName === 'string' ? meta.baseRefName : '',
    headBranch: typeof meta.headRefName === 'string' ? meta.headRefName : '',
    baseSha: typeof meta.baseRefOid === 'string' ? meta.baseRefOid : '',
    headSha: typeof meta.headRefOid === 'string' ? meta.headRefOid : '',
    repoSlug,
    files,
  })
}

function derivePrState(meta: Record<string, unknown>): PullRequestDiffSnapshot['state'] {
  if (meta.merged === true) return 'merged'
  const state = typeof meta.state === 'string' ? meta.state.toLowerCase() : ''
  if (state === 'merged') return 'merged'
  if (state === 'closed') return 'closed'
  return 'open'
}

function runGhCapture(repoPath: string, args: string[]): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveGhCommand(), args, {
      cwd: repoPath,
      env: buildProcessEnvironment(),
      stdio: 'pipe',
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') resolve(null)
      else reject(err)
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout)
        return
      }

      const errorText = stderr.trim() || stdout.trim()
      if (
        errorText.includes('not logged') ||
        errorText.includes('auth login') ||
        errorText.includes('401') ||
        errorText.includes('GH_TOKEN')
      ) {
        resolve(null)
        return
      }

      reject(new Error(errorText || `gh ${args[0]} ${args[1] ?? ''} failed`))
    })

    child.stdin.end()
  })
}

async function fetchPullRequestViaApi(
  remoteInfo: GitRemoteInfo,
  prNumber: number,
  token: string,
): Promise<PullRequestDiffSnapshot> {
  const repoSlug = `${remoteInfo.owner}/${remoteInfo.repo}`
  const pr = await githubApiGet<{
    number: number
    html_url: string
    title: string
    state: string
    merged: boolean
    base: { ref: string; sha: string }
    head: { ref: string; sha: string }
  }>(`/repos/${repoSlug}/pulls/${prNumber}`, token)

  const files = await githubApiGetAllPages<{
    filename: string
    previous_filename?: string
    status?: string
    patch?: string
  }>(`/repos/${repoSlug}/pulls/${prNumber}/files`, token)

  return normalizePullRequestSnapshot({
    prNumber: pr.number,
    url: pr.html_url,
    title: pr.title,
    state: pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open',
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    repoSlug,
    files,
  })
}

function githubApiGet<T>(path: string, token: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'lobrecs-agent',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString()
        })
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            try {
              const parsed = JSON.parse(data) as { message?: string }
              reject(new Error(parsed.message ?? `GitHub API error: ${res.statusCode}`))
            } catch {
              reject(new Error(`GitHub API error: ${res.statusCode}`))
            }
            return
          }

          try {
            resolve(JSON.parse(data) as T)
          } catch (err) {
            reject(err instanceof Error ? err : new Error('Failed to parse GitHub API response'))
          }
        })
      },
    )

    req.on('error', (err: Error) => reject(new Error(`GitHub API request failed: ${err.message}`)))
    req.end()
  })
}

async function githubApiGetAllPages<T>(path: string, token: string): Promise<T[]> {
  const results: T[] = []
  let page = 1
  const perPage = 100

  while (page <= 10) {
    const separator = path.includes('?') ? '&' : '?'
    const pageUrl = `${path}${separator}per_page=${perPage}&page=${page}`
    const batch = await githubApiGet<T[]>(pageUrl, token)
    if (!Array.isArray(batch) || batch.length === 0) break

    results.push(...batch)
    if (batch.length < perPage) break
    page += 1
  }

  return results
}
