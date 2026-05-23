import type {
  ExtensionMcpServerArtifact,
  MarketplaceExtension,
} from '../../../../shared/types'

const DEFAULT_REGISTRY_URL = 'https://registry.modelcontextprotocol.io'
const REGISTRY_PAGE_SIZE = 80
const CACHE_TTL_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 3_500
const TARGET_AGENTS = ['claude-code', 'codex', 'opencode'] as const

type FetchLike = typeof fetch

interface RegistryCatalogProviderOptions {
  registryUrl?: string
  fetchImpl?: FetchLike
  cacheTtlMs?: number
  timeoutMs?: number
}

interface CachedCatalog {
  key: string
  expiresAt: number
  items: MarketplaceExtension[]
}

interface RegistryServerListResponse {
  servers?: unknown[]
}

interface RegistryServerResponse {
  server?: RegistryServer
  _meta?: {
    'io.modelcontextprotocol.registry/official'?: {
      status?: string
      statusMessage?: string
      updatedAt?: string
      isLatest?: boolean
    }
  }
}

interface RegistryServer {
  name?: string
  title?: string
  description?: string
  version?: string
  websiteUrl?: string
  repository?: {
    url?: string
    source?: string
  }
  remotes?: RegistryRemote[]
  packages?: RegistryPackage[]
}

interface RegistryRemote {
  type?: string
  url?: string
  headers?: RegistryKeyValueInput[]
}

interface RegistryPackage {
  registryType?: string
  identifier?: string
  version?: string
  runtimeHint?: string
  transport?: {
    type?: string
  }
  runtimeArguments?: RegistryArgument[]
  packageArguments?: RegistryArgument[]
  environmentVariables?: RegistryKeyValueInput[]
}

interface RegistryArgument {
  type?: string
  name?: string
  value?: string
  isSecret?: boolean
}

interface RegistryKeyValueInput {
  name?: string
  value?: string
  isSecret?: boolean
}

export class McpRegistryCatalogProvider {
  private cache: CachedCatalog | null = null
  private readonly registryUrl: string
  private readonly fetchImpl: FetchLike
  private readonly cacheTtlMs: number
  private readonly timeoutMs: number

  constructor(options: RegistryCatalogProviderOptions = {}) {
    this.registryUrl = (options.registryUrl ?? DEFAULT_REGISTRY_URL).replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  }

  async list(query?: string): Promise<MarketplaceExtension[]> {
    if (process.env.LOBRECS_DISABLE_EXTERNAL_EXTENSION_CATALOG === '1') return []

    const normalizedQuery = query?.trim()
    const cacheKey = normalizedQuery?.toLowerCase() ?? ''
    const now = Date.now()
    if (this.cache?.key === cacheKey && this.cache.expiresAt > now) {
      return this.cache.items.map(cloneExtension)
    }

    try {
      const items = await this.fetchRegistryCatalog(normalizedQuery)
      this.cache = {
        key: cacheKey,
        expiresAt: now + this.cacheTtlMs,
        items,
      }
      return items.map(cloneExtension)
    } catch {
      return this.cache?.items.map(cloneExtension) ?? []
    }
  }

  private async fetchRegistryCatalog(query: string | undefined): Promise<MarketplaceExtension[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const url = new URL('/v0.1/servers', this.registryUrl)
      url.searchParams.set('limit', String(REGISTRY_PAGE_SIZE))
      url.searchParams.set('version', 'latest')
      if (query) url.searchParams.set('search', query)

      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`MCP registry request failed: ${response.status}`)

      const payload = (await response.json()) as RegistryServerListResponse
      const servers = Array.isArray(payload.servers) ? payload.servers : []

      return servers
        .map((entry) => mapRegistryEntry(entry))
        .filter((entry): entry is MarketplaceExtension => entry !== null)
    } finally {
      clearTimeout(timeout)
    }
  }
}

function mapRegistryEntry(entry: unknown): MarketplaceExtension | null {
  if (!isRegistryServerResponse(entry)) return null

  const server = entry.server
  if (!server) return null

  const name = cleanText(server.name)
  const description = cleanText(server.description)
  if (!name || !description) return null

  const status = entry._meta?.['io.modelcontextprotocol.registry/official']?.status
  if (status && status !== 'active') return null

  const artifacts = registryArtifacts(server)
  const title = cleanText(server.title) ?? displayNameFromServerName(name)
  const publisher = publisherFromServer(server) ?? 'MCP Registry'
  const version = cleanText(server.version)
  const registryTypes = packageRegistryTypes(server.packages)
  const remoteHosts = remoteHostTags(server.remotes)
  const setupNotes = setupNotesForServer(server, artifacts)

  return {
    id: `mcp-registry:${name}`,
    name: title,
    summary: description,
    description,
    publisher,
    category: 'mcp-server',
    source: 'external',
    tags: sortedUnique([
      'mcp',
      'registry',
      ...remoteHosts,
      ...registryTypes,
      ...(artifacts.some((artifact) => artifact.transport === 'http') ? ['remote'] : []),
      ...(artifacts.some((artifact) => artifact.transport === 'stdio') ? ['local'] : []),
    ]),
    targetAgents: [...TARGET_AGENTS],
    homepageUrl: cleanText(server.websiteUrl) ?? cleanText(server.repository?.url),
    documentationUrl: cleanText(server.repository?.url),
    setupNotes,
    permissions: permissionsForServer(server, artifacts),
    artifacts,
    featured: false,
    recommended: false,
  }
}

function registryArtifacts(server: RegistryServer): ExtensionMcpServerArtifact[] {
  const remoteArtifacts = (server.remotes ?? [])
    .map((remote) => remoteArtifact(server, remote))
    .filter((artifact): artifact is ExtensionMcpServerArtifact => artifact !== null)
  if (remoteArtifacts.length > 0) return remoteArtifacts.slice(0, 1)

  const packageArtifacts = (server.packages ?? [])
    .map((pkg) => packageArtifact(server, pkg))
    .filter((artifact): artifact is ExtensionMcpServerArtifact => artifact !== null)
  return packageArtifacts.slice(0, 1)
}

function remoteArtifact(
  server: RegistryServer,
  remote: RegistryRemote,
): ExtensionMcpServerArtifact | null {
  const url = cleanText(remote.url)
  if (!url || !isHttpUrl(url)) return null
  if (remote.type !== 'streamable-http' && remote.type !== 'sse') return null
  if (hasSecretInputs(remote.headers)) return null

  return {
    kind: 'mcp-server',
    serverName: serverNameFromRegistryName(server.name),
    transport: 'http',
    url,
    headers: keyValueInputsToRecord(remote.headers),
  }
}

function packageArtifact(
  server: RegistryServer,
  pkg: RegistryPackage,
): ExtensionMcpServerArtifact | null {
  if (pkg.transport?.type !== 'stdio') return null
  if (hasSecretInputs(pkg.environmentVariables)) return null

  const identifier = cleanText(pkg.identifier)
  if (!identifier) return null

  const registryType = cleanText(pkg.registryType)?.toLowerCase()
  const runtimeHint = cleanText(pkg.runtimeHint)?.toLowerCase()
  const version = cleanText(pkg.version)
  const args = [
    ...registryArguments(pkg.runtimeArguments),
    ...registryArguments(pkg.packageArguments),
  ]

  if (runtimeHint === 'npx' || registryType === 'npm') {
    return {
      kind: 'mcp-server',
      serverName: serverNameFromRegistryName(server.name),
      transport: 'stdio',
      command: 'npx',
      args: ['-y', packageSpecifier(identifier, version, '@'), ...args],
      env: keyValueInputsToRecord(pkg.environmentVariables),
    }
  }

  if (runtimeHint === 'uvx' || registryType === 'pypi') {
    return {
      kind: 'mcp-server',
      serverName: serverNameFromRegistryName(server.name),
      transport: 'stdio',
      command: 'uvx',
      args: [packageSpecifier(identifier, version, '=='), ...args],
      env: keyValueInputsToRecord(pkg.environmentVariables),
    }
  }

  return null
}

function registryArguments(inputs: RegistryArgument[] | undefined): string[] {
  return (inputs ?? []).flatMap((input) => {
    if (input.isSecret) return []
    const value = cleanText(input.value)
    if (!value) return []
    if (input.type === 'named') {
      const name = cleanText(input.name)
      return name ? [name, value] : []
    }
    return [value]
  })
}

function setupNotesForServer(
  server: RegistryServer,
  artifacts: readonly ExtensionMcpServerArtifact[],
): string[] {
  const notes = [
    'Loaded from the public MCP registry. Review the package or remote URL before installing.',
  ]
  const version = cleanText(server.version)
  if (version) notes.push(`Registry version: ${version}.`)
  if (artifacts.length === 0) {
    notes.push('No supported remote or package install recipe was found for Lobrecs Agent yet.')
  }
  if (hasSecretInputs(server.packages?.flatMap((pkg) => pkg.environmentVariables ?? []))) {
    notes.push('Secret environment variables must be configured outside Lobrecs Agent.')
  }
  return notes
}

function permissionsForServer(
  server: RegistryServer,
  artifacts: readonly ExtensionMcpServerArtifact[],
): string[] {
  if (artifacts.some((artifact) => artifact.transport === 'http')) {
    const hosts = remoteHostTags(server.remotes)
    return [`Network access to ${hosts.length ? hosts.join(', ') : 'the configured MCP remote'}`]
  }

  if (artifacts.some((artifact) => artifact.transport === 'stdio')) {
    return ['Runs the registry package locally through the configured package runtime']
  }

  return []
}

function packageRegistryTypes(packages: RegistryPackage[] | undefined): string[] {
  return sortedUnique(
    (packages ?? [])
      .map((pkg) => cleanText(pkg.registryType)?.toLowerCase())
      .filter((value): value is string => Boolean(value)),
  )
}

function remoteHostTags(remotes: RegistryRemote[] | undefined): string[] {
  return sortedUnique(
    (remotes ?? [])
      .map((remote) => hostnameFromUrl(remote.url))
      .filter((value): value is string => Boolean(value)),
  )
}

function publisherFromServer(server: RegistryServer): string | null {
  const repositoryUrl = cleanText(server.repository?.url)
  if (repositoryUrl) {
    try {
      const url = new URL(repositoryUrl)
      if (url.hostname === 'github.com') return url.pathname.split('/').filter(Boolean)[0] ?? null
      return url.hostname.replace(/^www\./, '')
    } catch {
      return null
    }
  }

  const namespace = cleanText(server.name)?.split('/')[0]
  return namespace ?? null
}

function displayNameFromServerName(name: string): string {
  const slug = name.split('/').at(-1) ?? name
  return slug
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function serverNameFromRegistryName(name: string | undefined): string {
  const normalized = (name ?? 'registry_mcp')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return normalized || 'registry_mcp'
}

function packageSpecifier(identifier: string, version: string | undefined, separator: string): string {
  if (!version) return identifier
  return `${identifier}${separator}${version}`
}

function keyValueInputsToRecord(inputs: RegistryKeyValueInput[] | undefined): Record<string, string> | undefined {
  const entries = (inputs ?? []).flatMap((input) => {
    const name = cleanText(input.name)
    const value = cleanText(input.value)
    return name && value && !input.isSecret ? [[name, value] as const] : []
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

function hasSecretInputs(inputs: RegistryKeyValueInput[] | undefined): boolean {
  return (inputs ?? []).some((input) => input.isSecret)
}

function cleanText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function hostnameFromUrl(value: unknown): string | null {
  const url = cleanText(value)
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function isRegistryServerResponse(value: unknown): value is RegistryServerResponse {
  return Boolean(value && typeof value === 'object' && 'server' in value)
}

function cloneExtension(extension: MarketplaceExtension): MarketplaceExtension {
  return structuredClone(extension)
}

export const mcpRegistryCatalogProvider = new McpRegistryCatalogProvider()
