import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ReviewIssue } from '../../../../shared/contracts/reviews'
import type { ReviewProviderAdapter } from './provider'

export class GitHubProviderAdapter implements ReviewProviderAdapter {
  async fetchIssues(projectId: string, repoPath: string): Promise<ReviewIssue[]> {
    // 1. Get repo owner and name
    const repoInfo = await this.runGh(['repo', 'view', '--json', 'owner,name'], repoPath)
    let owner: string
    let name: string
    try {
      const parsed = JSON.parse(repoInfo)
      owner = parsed.owner.login
      name = parsed.name
    } catch (err: any) {
      throw new Error(`Failed to view repository: ${err.message || 'gh command not found or not authenticated'}`)
    }

    // 2. Get PR number for the current branch
    const prInfo = await this.runGh(['pr', 'view', '--json', 'number'], repoPath)
    let prNumber: number
    try {
      const parsed = JSON.parse(prInfo)
      prNumber = parsed.number
    } catch {
      throw new Error('No open pull request found on GitHub for this branch. Please create a pull request or push the branch first.')
    }

    // 3. Fetch review comments
    const commentsJson = await this.runGh(['api', `repos/${owner}/${name}/pulls/${prNumber}/comments`], repoPath)
    let comments: any[]
    try {
      comments = JSON.parse(commentsJson)
    } catch {
      throw new Error('Failed to parse pull request review comments from GitHub API.')
    }

    if (!Array.isArray(comments)) {
      return []
    }

    const now = Date.now()
    return comments.map((c: any) => ({
      id: randomUUID(),
      projectId,
      provider: 'github',
      sourceId: String(c.id),
      sourceUrl: c.html_url || undefined,
      providerRef: String(prNumber),
      severity: 'medium',
      category: 'maintainability',
      title: `GitHub comment by @${c.user?.login || 'unknown'}`,
      detail: c.body || '',
      filePath: c.path || undefined,
      line: typeof c.line === 'number' ? c.line : (typeof c.original_line === 'number' ? c.original_line : undefined),
      status: 'open',
      createdAt: c.created_at ? new Date(c.created_at).getTime() : now,
      updatedAt: c.updated_at ? new Date(c.updated_at).getTime() : now,
    }))
  }

  private runGh(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('gh', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
      child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
      child.on('error', (err) => { reject(err) })
      child.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `gh ${args.join(' ')} exited with code ${code}`))
        } else {
          resolve(stdout)
        }
      })
      child.stdin?.end()
    })
  }
}
