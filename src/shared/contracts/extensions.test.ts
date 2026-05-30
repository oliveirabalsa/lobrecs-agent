import { describe, expect, it } from 'vitest'
import {
  validateInstallExtensionInput,
  validateRunExtensionDoctorInput,
  validateSearchMarketplaceExtensionsInput,
  validateUpdateExtensionRuntimeStateInput,
} from './extensions'

describe('extension contract validators', () => {
  it('normalizes extension catalog search input', () => {
    expect(
      validateSearchMarketplaceExtensionsInput({
        query: ' docs ',
        categories: ['mcp-server', 'mcp-server'],
        sources: ['external'],
        targetAgents: ['codex'],
        tags: ['search'],
        limit: 25,
      }),
    ).toEqual({
      query: 'docs',
      categories: ['mcp-server'],
      sources: ['external'],
      targetAgents: ['codex'],
      tags: ['search'],
      limit: 25,
    })
  })

  it('treats blank catalog queries as no query', () => {
    expect(validateSearchMarketplaceExtensionsInput({ query: '' })).toEqual({})
    expect(validateSearchMarketplaceExtensionsInput({ query: '   ' })).toEqual({})
  })

  it('rejects unsupported catalog filters', () => {
    expect(() => validateSearchMarketplaceExtensionsInput({ categories: ['../../bad'] })).toThrow(
      'Extension category is invalid',
    )
  })

  it('requires project-scoped installs to carry an absolute project path', () => {
    expect(() =>
      validateInstallExtensionInput({
        extensionId: 'openai-developer-docs',
        scope: 'project',
      }),
    ).toThrow('require a project path')

    expect(() =>
      validateInstallExtensionInput({
        extensionId: 'openai-developer-docs',
        scope: 'project',
        projectPath: '../repo',
      }),
    ).toThrow('must be an absolute path')
  })

  it('allows registry extension ids without allowing traversal payloads', () => {
    expect(
      validateInstallExtensionInput({
        extensionId: 'mcp-registry:io.example/docs',
        scope: 'global',
        targetAgents: ['codex', 'codex'],
      }),
    ).toEqual({
      extensionId: 'mcp-registry:io.example/docs',
      scope: 'global',
      targetAgents: ['codex'],
    })

    expect(() =>
      validateInstallExtensionInput({
        extensionId: '../escape',
        scope: 'global',
      }),
    ).toThrow('path traversal')
  })

  it('validates runtime state and doctor ids', () => {
    expect(
      validateUpdateExtensionRuntimeStateInput({
        installationId: 'install-1',
        trusted: true,
      }),
    ).toEqual({ installationId: 'install-1', trusted: true })
    expect(validateRunExtensionDoctorInput({ installationId: 'install-1' })).toEqual({
      installationId: 'install-1',
    })
    expect(() =>
      validateUpdateExtensionRuntimeStateInput({ installationId: 'install-1', enabled: 'yes' }),
    ).toThrow('enabled must be boolean')
  })
})
