import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { GitProviderType } from '../../../../shared/types'

const GITHUB_TEMPLATE_CANDIDATES = [
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
]

const AZURE_TEMPLATE_CANDIDATES = [
  '.azuredevops/pull_request_template.md',
  'pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
]

const GITHUB_DEFAULT = `## Summary

<!-- Describe what this PR does and why -->

## Changes

<!-- List the key changes -->

## Test plan

<!-- How was this tested? -->
`

const AZURE_DEFAULT = `## Summary

<!-- Describe what this PR does and why -->

## Changes

<!-- List the key changes -->

## Test plan

<!-- How was this tested? -->

## Related work items

<!-- Link related Azure DevOps work items or tickets -->
`

export async function loadPrTemplate(repoPath: string, provider: GitProviderType): Promise<string> {
  if (provider === 'unsupported') return ''

  const candidates = provider === 'github' ? GITHUB_TEMPLATE_CANDIDATES : AZURE_TEMPLATE_CANDIDATES

  for (const candidate of candidates) {
    try {
      const content = await readFile(path.join(repoPath, candidate), 'utf-8')
      if (content.trim()) return content
    } catch {
      // not found, try next candidate
    }
  }

  return provider === 'github' ? GITHUB_DEFAULT : AZURE_DEFAULT
}
