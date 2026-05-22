import type { MainIpcContext } from '../../shared/ipcContext'
import { requireProject } from '../../projects/application/requireProject'
import { runGit } from '../infrastructure/runGit'
import type {
  GitRemoteInfo,
  CreatePullRequestInput,
  CreatePullRequestFromDraftInput,
  CreatePullRequestResult,
  GeneratePullRequestDraftInput,
  GeneratePullRequestDraftResult,
  GitProviderType,
} from '../../../../shared/contracts/git'
import { getProviderType, isGitHubRemote, isAzureRemote } from '../domain/pullRequest'

export class PullRequestWorkflowService {
  constructor(private readonly context: MainIpcContext) {}

  async getRemoteInfo(projectId: string): Promise<GitRemoteInfo> {
    const project = requireProject(projectId)
    const result = await runGit(['remote', 'get-url', 'origin'], project.repoPath)

    if (result.exitCode !== 0) {
      throw new Error('No origin remote configured.')
    }

    const remoteUrl = result.stdout.trim()
    const providerType = getProviderType(remoteUrl)

    if (providerType === 'unsupported') {
      throw new Error('Unsupported remote provider. Only GitHub (github.com) and Azure DevOps (dev.azure.com, visualstudio.com) are supported.')
    }

    const detected = this.detectRemote(remoteUrl, providerType)

    return detected
  }

  async createPullRequest(
    projectId: string,
    input: Omit<CreatePullRequestInput, 'projectId'>,
  ): Promise<CreatePullRequestResult> {
    const remoteInfo = await this.getRemoteInfo(projectId)

    if (remoteInfo.provider === 'github') {
      return this.createGitHubPullRequest(projectId, remoteInfo, input)
    }

    if (remoteInfo.provider === 'azure') {
      return this.createAzurePullRequest(projectId, remoteInfo, input)
    }

    throw new Error('Unsupported remote provider.')
  }

  async generatePrDraft(input: GeneratePullRequestDraftInput): Promise<GeneratePullRequestDraftResult> {
    const project = requireProject(input.projectId)
    const template = await this.resolveTemplate(input.projectId)

    const [commitsResult, diffStatResult] = await Promise.all([
      runGit(
        ['log', `origin/${input.baseBranch}..${input.headBranch}`, '--oneline', '--no-merges', '--max-count=20'],
        project.repoPath,
      ).catch(() => ({ exitCode: 0, stdout: '', stderr: '' })),
      runGit(
        ['diff', '--stat', `origin/${input.baseBranch}...${input.headBranch}`],
        project.repoPath,
      ).catch(() => ({ exitCode: 0, stdout: '', stderr: '' })),
    ])

    const commits = commitsResult.stdout.trim()
    const diffStat = diffStatResult.stdout.trim()

    const prompt = [
      'Generate a pull request title and description for these Git changes.',
      `Source branch: ${input.headBranch}  →  Target: ${input.baseBranch}`,
      commits ? `\nRecent commits:\n${commits}` : '',
      diffStat ? `\nChanged files:\n${diffStat}` : '',
      '\nRespond with ONLY a JSON object (no markdown fences, no extra text):',
      '{"title":"concise PR title under 72 chars","body":"markdown PR description with ## Summary and ## Changes sections"}',
    ].filter(Boolean).join('\n')

    try {
      const { runCommandText, resolveCommand } = await import('../../../agents/command')
      const claude = resolveCommand('CLAUDE_COMMAND', 'claude')
      const output = await runCommandText(
        claude,
        ['--print', '--output-format', 'text', '--model', 'claude-haiku-4-5-20251001', prompt],
        { timeout: 45_000, maxBuffer: 512 * 1024 },
      )
      const jsonMatch = output.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { title?: string; body?: string }
        if (parsed.title && parsed.body) {
          return { title: parsed.title, body: parsed.body }
        }
      }
    } catch {
      // fall through to template fallback
    }

    return {
      title: createDraftTitle(input.headBranch, input.baseBranch),
      body: template,
    }
  }

  async createPrFromDraft(
    input: CreatePullRequestFromDraftInput,
  ): Promise<CreatePullRequestResult> {
    return this.createPullRequest(input.projectId, {
      title: input.title,
      body: input.body,
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
    })
  }

  async resolveTemplate(projectId: string): Promise<string> {
    const project = requireProject(projectId)
    const remoteInfo = await this.getRemoteInfo(projectId)

    const candidates =
      remoteInfo.provider === 'github'
        ? [
            '.github/PULL_REQUEST_TEMPLATE.md',
            '.github/pull_request_template.md',
            'docs/pull_request_template.md',
            'pull_request_template.md',
          ]
        : remoteInfo.provider === 'azure'
          ? [
              '.azuredevops/pull_request_template.md',
              'docs/pull_request_template.md',
              'pull_request_template.md',
            ]
          : []

    const { promises: fs } = await import('node:fs')
    for (const candidate of candidates) {
      const fullPath = `${project.repoPath}/${candidate}`
      try {
        const stat = await fs.stat(fullPath)
        if (stat.isFile()) {
          return (await fs.readFile(fullPath, 'utf-8')).trim()
        }
      } catch {
        continue
      }
    }

    return remoteInfo.provider === 'github'
      ? this.defaultGitHubTemplate()
      : remoteInfo.provider === 'azure'
        ? this.defaultAzureTemplate()
        : ''
  }

  private detectRemote(remoteUrl: string, providerType: GitProviderType): GitRemoteInfo {
    const cleaned = remoteUrl.replace(/\.git$/, '').trim()

    if (providerType === 'github') {
      const httpsMatch = cleaned.match(/^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/.]+)/)
      if (httpsMatch) {
        return { url: cleaned, provider: 'github', owner: httpsMatch[1], repo: httpsMatch[2] }
      }

      const sshMatch = cleaned.match(/^git@github\.com:([^/]+)\/([^/.]+)/)
      if (sshMatch) {
        return { url: cleaned, provider: 'github', owner: sshMatch[1], repo: sshMatch[2] }
      }
    }

    if (providerType === 'azure') {
      const httpsMatch = cleaned.match(/^https?:\/\/([^@]+)@?\.?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/)
      if (httpsMatch) {
        const [, , org, project, repo] = httpsMatch
        return { url: cleaned, provider: 'azure', owner: `${org}/${project}`, repo }
      }

      const vsMatch = cleaned.match(/^https?:\/\/[^@]*@?visualstudio\.com\/([^/]+)\/_git\/([^/]+)/)
      if (vsMatch) {
        return { url: cleaned, provider: 'azure', owner: vsMatch[1], repo: vsMatch[2] }
      }

      const sshMatch = cleaned.match(/^git@dev\.azure\.com:([^/]+)\/([^/.]+)/)
      if (sshMatch) {
        return { url: cleaned, provider: 'azure', owner: sshMatch[1], repo: sshMatch[2] }
      }
    }

    return { url: cleaned, provider: 'unsupported', owner: '', repo: '' }
  }

  private async createGitHubPullRequest(
    projectId: string,
    remoteInfo: GitRemoteInfo,
    input: Omit<CreatePullRequestInput, 'projectId'>,
  ): Promise<CreatePullRequestResult> {
    const project = requireProject(projectId)
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null

    if (token) {
      const apiUrl = `https://api.github.com/repos/${remoteInfo.owner}/${remoteInfo.repo}/pulls`
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          head: input.headBranch,
          base: input.baseBranch,
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`GitHub API error: ${response.status} - ${error}`)
      }

      const data = await response.json() as { html_url: string; number: number }
      return { url: data.html_url, number: data.number }
    }

    return this.createGitHubPrViaCli(project.repoPath, input)
  }

  private async createGitHubPrViaCli(
    repoPath: string,
    input: Omit<CreatePullRequestInput, 'projectId'>,
  ): Promise<CreatePullRequestResult> {
    const { spawn } = await import('node:child_process')

    return new Promise((resolve, reject) => {
      const child = spawn(
        'gh',
        ['pr', 'create', '--title', input.title, '--body', input.body, '--base', input.baseBranch],
        { cwd: repoPath, stdio: ['pipe', 'pipe', 'pipe'] },
      )

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', (error) => {
        reject(new Error(`gh CLI not found: ${error.message}`))
      })
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `gh pr create failed: ${code}`))
          return
        }

        const urlMatch = stdout.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/)
        if (urlMatch) {
          const numberMatch = urlMatch[0].match(/\/pull\/(\d+)/)
          resolve({ url: urlMatch[0], number: numberMatch ? parseInt(numberMatch[1], 10) : 0 })
        } else {
          reject(new Error('Could not parse PR URL from gh output'))
        }
      })
    })
  }

  private async createAzurePullRequest(
    projectId: string,
    remoteInfo: GitRemoteInfo,
    input: Omit<CreatePullRequestInput, 'projectId'>,
  ): Promise<CreatePullRequestResult> {
    const token = process.env.AZURE_DEVOPS_PAT ?? process.env.AZURE_DEVOPS_TOKEN ?? process.env.AZURE_TOKEN

    if (!token) {
      throw new Error('Azure DevOps PAT not configured. Set AZURE_DEVOPS_PAT, AZURE_DEVOPS_TOKEN, or AZURE_TOKEN environment variable.')
    }

    const parts = remoteInfo.owner.split('/')
    if (parts.length !== 2) {
      throw new Error('Invalid Azure DevOps remote format. Expected {org}/{project}.')
    }

    const [org, project] = parts
    const repo = remoteInfo.repo
    const apiUrl = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}/pullrequests?api-version=7.1`

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`:${token}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: input.title,
        description: input.body,
        sourceRefName: `refs/heads/${input.headBranch}`,
        targetRefName: `refs/heads/${input.baseBranch}`,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Azure DevOps API error: ${response.status} - ${error}`)
    }

    const data = await response.json() as { pullRequestId: number; remoteUrl: string }
    return { url: data.remoteUrl, number: data.pullRequestId }
  }

  private defaultGitHubTemplate(): string {
    return `## Description

<!-- Provide a brief description of the changes -->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

<!-- Describe testing performed -->

## Checklist

- [ ] Code follows project style
- [ ] Tests pass
- [ ] Documentation updated
`
  }

  private defaultAzureTemplate(): string {
    return `## Description

<!-- Describe your changes here -->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactoring

## Related Work Items

<!-- Link to Azure DevOps work items if applicable -->

## Testing

<!-- Describe testing performed -->
`
  }
}

function createDraftTitle(headBranch: string, baseBranch: string): string {
  const normalized = headBranch
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^[a-z]+\/+/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()

  const summary = normalized.length > 0
    ? normalized
    : `changes from ${headBranch || 'current branch'}`

  const sentence = capitalize(summary)
  return `feat: ${sentence} -> ${baseBranch.trim() || 'main'}`
}

function capitalize(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}
