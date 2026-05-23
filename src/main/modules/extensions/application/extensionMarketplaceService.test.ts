import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InstalledExtensionRecord, MarketplaceExtension } from '../../../../shared/types'
import {
  ExtensionMarketplaceService,
  type ExtensionCatalogProvider,
  type ExtensionRepository,
} from './extensionMarketplaceService'

let repoPath: string
let records: InstalledExtensionRecord[]

describe('ExtensionMarketplaceService', () => {
  beforeEach(async () => {
    repoPath = await mkdtemp(path.join(os.tmpdir(), 'lobrecs-agent-extensions-'))
    records = []
  })

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true })
  })

  it('installs an MCP server into Codex, Claude Code, and OpenCode project configs', async () => {
    const service = serviceWithCatalog()
    const installed = await service.install({
      extensionId: 'openai-developer-docs',
      scope: 'project',
      projectPath: repoPath,
    })

    expect(installed.actions).toHaveLength(3)
    expect(installed.actions.every((action) => action.status === 'installed')).toBe(true)

    await expect(readFile(path.join(repoPath, '.codex/config.toml'), 'utf8')).resolves.toContain(
      '[mcp_servers.openaiDeveloperDocs]',
    )
    await expect(readFile(path.join(repoPath, '.mcp.json'), 'utf8')).resolves.toContain(
      '"openaiDeveloperDocs"',
    )
    await expect(readFile(path.join(repoPath, 'opencode.json'), 'utf8')).resolves.toContain(
      '"openaiDeveloperDocs"',
    )
  })

  it('installs skills only for target agents with skill-compatible config surfaces', async () => {
    const service = serviceWithCatalog()
    const installed = await service.install({
      extensionId: 'lobrecs-clean-code-skill',
      scope: 'project',
      projectPath: repoPath,
      targetAgents: ['claude-code', 'codex', 'opencode'],
    })

    expect(installed.targetAgents).toEqual(['codex', 'opencode'])
    expect(installed.actions.map((action) => action.agentId).sort()).toEqual(['codex', 'opencode'])
    await expect(
      readFile(path.join(repoPath, '.codex/skills/lobrecs-clean-code/SKILL.md'), 'utf8'),
    ).resolves.toContain('Lobrecs Clean Code')
    await expect(
      readFile(path.join(repoPath, '.opencode/instructions/lobrecs-clean-code.md'), 'utf8'),
    ).resolves.toContain('Lobrecs Clean Code')
  })

  it('searches catalog entries by type, provider, tags, and query', async () => {
    const service = serviceWithCatalog()

    const result = await service.searchCatalog({
      query: 'playwright',
      categories: ['mcp-server'],
      targetAgents: ['codex'],
    })

    expect(result.items.map((item) => item.id)).toEqual(['playwright-mcp'])
    expect(result.total).toBe(1)
    expect(result.tags).toContain('mcp')
    expect(result.publishers).toContain('Microsoft Playwright')
  })

  it('surfaces skills.sh skills as searchable external skill entries', async () => {
    const service = serviceWithCatalog()

    const result = await service.searchCatalog({
      query: 'react performance',
      categories: ['skill'],
      sources: ['external'],
      targetAgents: ['codex'],
    })

    expect(result.items.map((item) => item.id)).toContain('skills-sh-react-best-practices')
    const reactSkill = result.items.find((item) => item.id === 'skills-sh-react-best-practices')
    expect(reactSkill?.artifacts[0]).toMatchObject({
      kind: 'skill',
      packageName: 'vercel-labs/agent-skills',
      cliSkillName: 'react-best-practices',
    })
  })

  it('merges external MCP registry entries into catalog search results', async () => {
    const service = serviceWithCatalog({
      externalCatalog: [
        {
          id: 'mcp-registry:io.example/docs',
          name: 'Example Docs MCP',
          summary: 'Searches external docs.',
          description: 'Searches external docs.',
          publisher: 'example',
          category: 'mcp-server',
          source: 'external',
          tags: ['mcp', 'registry', 'docs'],
          targetAgents: ['claude-code', 'codex', 'opencode'],
          artifacts: [
            {
              kind: 'mcp-server',
              serverName: 'io_example_docs',
              transport: 'http',
              url: 'https://docs.example.com/mcp',
            },
          ],
        },
      ],
    })

    const result = await service.searchCatalog({
      query: 'example',
      sources: ['external'],
      targetAgents: ['opencode'],
    })

    expect(result.items.map((item) => item.id)).toEqual(['mcp-registry:io.example/docs'])
    expect(result.tags).toContain('registry')
    expect(result.publishers).toContain('example')
  })

  it('installs an external registry remote MCP server', async () => {
    const service = serviceWithCatalog({
      externalCatalog: [
        {
          id: 'mcp-registry:io.example/docs',
          name: 'Example Docs MCP',
          summary: 'Searches external docs.',
          description: 'Searches external docs.',
          publisher: 'example',
          category: 'mcp-server',
          source: 'external',
          tags: ['mcp', 'registry', 'docs'],
          targetAgents: ['codex'],
          artifacts: [
            {
              kind: 'mcp-server',
              serverName: 'io_example_docs',
              transport: 'http',
              url: 'https://docs.example.com/mcp',
            },
          ],
        },
      ],
    })

    await service.install({
      extensionId: 'mcp-registry:io.example/docs',
      scope: 'project',
      projectPath: repoPath,
      targetAgents: ['codex'],
    })

    await expect(readFile(path.join(repoPath, '.codex/config.toml'), 'utf8')).resolves.toContain(
      'https://docs.example.com/mcp',
    )
  })

  it('does not directly install provider-only catalog entries', async () => {
    const service = serviceWithCatalog()

    await expect(
      service.install({
        extensionId: 'mcp-registry-provider',
        scope: 'global',
      }),
    ).rejects.toThrow('provider entry')
  })

  it('injects the selected project path into project-bound MCP configs', async () => {
    const service = serviceWithCatalog()
    await service.install({
      extensionId: 'filesystem-mcp',
      scope: 'project',
      projectPath: repoPath,
      targetAgents: ['codex'],
    })

    await expect(readFile(path.join(repoPath, '.codex/config.toml'), 'utf8')).resolves.toContain(
      JSON.stringify(repoPath),
    )
  })
})

function serviceWithCatalog({
  externalCatalog = [],
}: {
  externalCatalog?: MarketplaceExtension[]
} = {}): ExtensionMarketplaceService {
  return new ExtensionMarketplaceService(fakeRepository(), undefined, [
    fakeCatalogProvider(externalCatalog),
  ])
}

function fakeCatalogProvider(items: MarketplaceExtension[]): ExtensionCatalogProvider {
  return {
    list: async () => items,
  }
}

function fakeRepository(): ExtensionRepository {
  return {
    list: () => records,
    save: (input) => {
      const record: InstalledExtensionRecord = {
        id: `record-${records.length + 1}`,
        extensionId: input.extensionId,
        scope: input.scope,
        projectPath: input.projectPath,
        targetAgents: input.targetAgents,
        actions: input.actions,
        installedAt: input.installedAt,
      }
      records.unshift(record)
      return record
    },
  }
}
