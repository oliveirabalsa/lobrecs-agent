import type {
  GitRemoteInfo,
  CreatePullRequestInput,
  CreatePullRequestResult,
  GitProviderType,
} from '../../../../shared/contracts/git'

export interface PullRequestProvider {
  readonly type: GitProviderType
  detectFromRemote(remoteUrl: string): GitRemoteInfo | null
  createPullRequest(input: CreatePullRequestInput): Promise<CreatePullRequestResult>
  resolveTemplate(repoPath: string): Promise<string>
}

export function detectProvider(remoteUrl: string): PullRequestProvider | null {
  if (!remoteUrl) return null
  if (isGitHubRemote(remoteUrl)) {
    return { type: 'github', detectFromRemote, createPullRequest, resolveTemplate }
  }
  if (isAzureRemote(remoteUrl)) {
    return { type: 'azure', detectFromRemote: azureDetectFromRemote, createPullRequest: azureCreatePullRequest, resolveTemplate: azureResolveTemplate }
  }
  return null
}

function detectFromRemote(remoteUrl: string): GitRemoteInfo | null {
  const cleaned = remoteUrl.replace(/\.git$/, '').trim()

  const httpsMatch = cleaned.match(/^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/.]+)/)
  if (httpsMatch) {
    return { url: cleaned, provider: 'github', owner: httpsMatch[1], repo: httpsMatch[2] }
  }

  const sshMatch = cleaned.match(/^git@github\.com:([^/]+)\/([^/.]+)/)
  if (sshMatch) {
    return { url: cleaned, provider: 'github', owner: sshMatch[1], repo: sshMatch[2] }
  }

  return null
}

async function createPullRequest(_input: CreatePullRequestInput): Promise<CreatePullRequestResult> {
  throw new Error('Use git provider API directly')
}

async function resolveTemplate(_repoPath: string): Promise<string> {
  return ''
}

function azureDetectFromRemote(remoteUrl: string): GitRemoteInfo | null {
  const cleaned = remoteUrl.replace(/\.git$/, '').trim()

  const httpsMatch = cleaned.match(/^https?:\/\/([^/]+)\/([^/]+)\/_git\/([^/]+)/)
  if (httpsMatch) {
    const [, , org, repo] = httpsMatch
    return {
      url: cleaned,
      provider: 'azure',
      owner: org,
      repo,
    }
  }

  const sshMatch = cleaned.match(/^git@([^.]+)\.com:([^/]+)\/([^/.]+)/)
  if (sshMatch) {
    return { url: cleaned, provider: 'azure', owner: sshMatch[2], repo: sshMatch[3] }
  }

  return null
}

async function azureCreatePullRequest(_input: CreatePullRequestInput): Promise<CreatePullRequestResult> {
  throw new Error('Use git provider API directly')
}

async function azureResolveTemplate(_repoPath: string): Promise<string> {
  return ''
}

export function getProviderInstance(type: GitProviderType): PullRequestProvider | null {
  switch (type) {
    case 'github':
      return { type: 'github', detectFromRemote, createPullRequest, resolveTemplate }
    case 'azure':
      return { type: 'azure', detectFromRemote: azureDetectFromRemote, createPullRequest: azureCreatePullRequest, resolveTemplate: azureResolveTemplate }
    default:
      return null
  }
}

export function isGitHubRemote(remoteUrl: string): boolean {
  return remoteUrl.includes('github.com')
}

export function isAzureRemote(remoteUrl: string): boolean {
  return (
    remoteUrl.includes('dev.azure.com') ||
    remoteUrl.includes('visualstudio.com') ||
    remoteUrl.includes('_git/')
  )
}

export function getProviderType(remoteUrl: string): GitProviderType {
  if (isGitHubRemote(remoteUrl)) return 'github'
  if (isAzureRemote(remoteUrl)) return 'azure'
  return 'unsupported'
}