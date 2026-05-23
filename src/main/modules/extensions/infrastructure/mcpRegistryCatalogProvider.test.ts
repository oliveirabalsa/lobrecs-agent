import { describe, expect, it, vi } from 'vitest'
import { McpRegistryCatalogProvider } from './mcpRegistryCatalogProvider'

describe('McpRegistryCatalogProvider', () => {
  it('maps remote registry servers into external MCP marketplace entries', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        servers: [
          {
            server: {
              name: 'io.example/docs',
              title: 'Example Docs',
              description: 'Search Example documentation.',
              version: '1.2.3',
              websiteUrl: 'https://example.com/docs',
              repository: {
                url: 'https://github.com/example/docs-mcp',
                source: 'github',
              },
              remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
            },
            _meta: {
              'io.modelcontextprotocol.registry/official': {
                status: 'active',
                isLatest: true,
              },
            },
          },
        ],
      }),
    )
    const provider = new McpRegistryCatalogProvider({ fetchImpl, cacheTtlMs: 1_000 })

    const items = await provider.list('docs')

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'mcp-registry:io.example/docs',
      name: 'Example Docs',
      publisher: 'example',
      source: 'external',
      category: 'mcp-server',
      homepageUrl: 'https://example.com/docs',
    })
    expect(items[0].tags).toEqual(['example.com', 'mcp', 'registry', 'remote'])
    expect(items[0].artifacts).toEqual([
      {
        kind: 'mcp-server',
        serverName: 'io_example_docs',
        transport: 'http',
        url: 'https://example.com/mcp',
      },
    ])
  })

  it('maps npm package registry servers without storing secret environment variables', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        servers: [
          {
            server: {
              name: 'io.example/local',
              description: 'Runs a local server.',
              packages: [
                {
                  registryType: 'npm',
                  identifier: '@example/local-mcp',
                  version: '2.0.0',
                  transport: { type: 'stdio' },
                  packageArguments: [{ type: 'positional', value: '--safe-mode' }],
                  environmentVariables: [
                    { name: 'PUBLIC_MODE', value: 'true' },
                    { name: 'API_KEY', isSecret: true },
                  ],
                },
              ],
            },
            _meta: {
              'io.modelcontextprotocol.registry/official': {
                status: 'active',
                isLatest: true,
              },
            },
          },
        ],
      }),
    )
    const provider = new McpRegistryCatalogProvider({ fetchImpl })

    const items = await provider.list('local')

    expect(items[0].artifacts).toHaveLength(0)
    expect(items[0].setupNotes).toContain('Secret environment variables must be configured outside Lobrecs Agent.')
  })

  it('uses cached data when the registry request fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          servers: [
            {
              server: {
                name: 'io.example/docs',
                description: 'Search docs.',
                remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
              },
              _meta: {
                'io.modelcontextprotocol.registry/official': {
                  status: 'active',
                  isLatest: true,
                },
              },
            },
          ],
        }),
      )
      .mockRejectedValueOnce(new Error('offline'))
    const provider = new McpRegistryCatalogProvider({ fetchImpl, cacheTtlMs: -1 })

    await provider.list()
    const fallback = await provider.list()

    expect(fallback.map((item) => item.id)).toEqual(['mcp-registry:io.example/docs'])
  })
})
