import { spawn } from 'node:child_process'
import https from 'node:https'
import type {
  CreatePullRequestInput,
  CreatePullRequestResult,
  GitRemoteInfo,
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
