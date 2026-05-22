import { describe, expect, it } from 'vitest'
import { GitHubPrProvider } from './githubPrProvider'

const provider = new GitHubPrProvider()

describe('GitHubPrProvider.detectFromRemote', () => {
  describe('SSH URLs', () => {
    it('detects standard SSH URL', () => {
      const info = provider.detectFromRemote('git@github.com:owner/repo.git')
      expect(info).toEqual({ url: 'git@github.com:owner/repo.git', provider: 'github', owner: 'owner', repo: 'repo' })
    })

    it('detects SSH URL without .git suffix', () => {
      const info = provider.detectFromRemote('git@github.com:myorg/myrepo')
      expect(info).toEqual({ url: 'git@github.com:myorg/myrepo', provider: 'github', owner: 'myorg', repo: 'myrepo' })
    })

    it('handles org names with hyphens and numbers', () => {
      const info = provider.detectFromRemote('git@github.com:my-org-123/repo-name-456.git')
      expect(info?.owner).toBe('my-org-123')
      expect(info?.repo).toBe('repo-name-456')
    })
  })

  describe('HTTPS URLs', () => {
    it('detects standard HTTPS URL', () => {
      const info = provider.detectFromRemote('https://github.com/owner/repo')
      expect(info).toEqual({ url: 'https://github.com/owner/repo', provider: 'github', owner: 'owner', repo: 'repo' })
    })

    it('detects HTTPS URL with .git suffix', () => {
      const info = provider.detectFromRemote('https://github.com/owner/repo.git')
      expect(info?.owner).toBe('owner')
      expect(info?.repo).toBe('repo')
    })

    it('detects HTTPS URL with embedded token', () => {
      const info = provider.detectFromRemote('https://ghp_token123@github.com/owner/repo.git')
      expect(info?.provider).toBe('github')
      expect(info?.owner).toBe('owner')
      expect(info?.repo).toBe('repo')
    })

    it('detects HTTP (non-TLS) URL', () => {
      const info = provider.detectFromRemote('http://github.com/owner/repo')
      expect(info?.provider).toBe('github')
    })
  })

  describe('non-GitHub URLs', () => {
    it('returns null for GitLab', () => {
      expect(provider.detectFromRemote('https://gitlab.com/owner/repo')).toBeNull()
    })

    it('returns null for Bitbucket', () => {
      expect(provider.detectFromRemote('https://bitbucket.org/owner/repo')).toBeNull()
    })

    it('returns null for Azure DevOps HTTPS', () => {
      expect(provider.detectFromRemote('https://dev.azure.com/org/project/_git/repo')).toBeNull()
    })

    it('returns null for Azure DevOps SSH', () => {
      expect(provider.detectFromRemote('git@ssh.dev.azure.com:v3/org/project/repo')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(provider.detectFromRemote('')).toBeNull()
    })
  })
})
