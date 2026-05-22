import { describe, expect, it } from 'vitest'
import { isGitHubRemote, isAzureRemote, getProviderType } from './pullRequest'

describe('isGitHubRemote', () => {
  it('detects https github.com URLs', () => {
    expect(isGitHubRemote('https://github.com/owner/repo')).toBe(true)
    expect(isGitHubRemote('https://github.com/owner/repo.git')).toBe(true)
    expect(isGitHubRemote('http://github.com/owner/repo')).toBe(true)
  })

  it('detects git@github.com SSH URLs', () => {
    expect(isGitHubRemote('git@github.com:owner/repo')).toBe(true)
    expect(isGitHubRemote('git@github.com:owner/repo.git')).toBe(true)
  })

  it('rejects non-github URLs', () => {
    expect(isGitHubRemote('https://gitlab.com/owner/repo')).toBe(false)
    expect(isGitHubRemote('https://bitbucket.org/owner/repo')).toBe(false)
    expect(isGitHubRemote('')).toBe(false)
  })
})

describe('isAzureRemote', () => {
  it('detects dev.azure.com URLs', () => {
    expect(isAzureRemote('https://dev.azure.com/org/project/_git/repo')).toBe(true)
    expect(isAzureRemote('https://dev.azure.com/org/project/_git/repo.git')).toBe(true)
  })

  it('detects visualstudio.com URLs', () => {
    expect(isAzureRemote('https://visualstudio.com/org/_git/repo')).toBe(true)
  })

  it('detects SSH URLs', () => {
    expect(isAzureRemote('git@dev.azure.com:org/repo')).toBe(true)
  })

  it('rejects non-azure URLs', () => {
    expect(isAzureRemote('https://github.com/owner/repo')).toBe(false)
    expect(isAzureRemote('https://gitlab.com/owner/repo')).toBe(false)
  })
})

describe('getProviderType', () => {
  it('returns github for GitHub URLs', () => {
    expect(getProviderType('https://github.com/owner/repo')).toBe('github')
    expect(getProviderType('git@github.com:owner/repo')).toBe('github')
  })

  it('returns azure for Azure DevOps URLs', () => {
    expect(getProviderType('https://dev.azure.com/org/project/_git/repo')).toBe('azure')
  })

  it('returns unsupported for unknown providers', () => {
    expect(getProviderType('https://gitlab.com/owner/repo')).toBe('unsupported')
    expect(getProviderType('')).toBe('unsupported')
  })
})