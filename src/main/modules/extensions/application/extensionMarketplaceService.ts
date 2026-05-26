import type {
  ExtensionInstallAction,
  ExtensionDoctorResult,
  MarketplaceCatalogSearchResult,
  ExtensionMarketplaceState,
  ExtensionTargetAgent,
  InstallExtensionInput,
  InstalledExtensionRecord,
  MarketplaceExtension,
  RunExtensionDoctorInput,
  SearchMarketplaceExtensionsInput,
  UpdateExtensionRuntimeStateInput,
} from '../../../../shared/types'
import {
  extensionsStore,
  type SaveExtensionDoctorResultInput,
  type SaveExtensionInstallationInput,
} from '../../../store/extensions'
import { EXTENSION_CATALOG } from '../domain/catalog'
import { installArtifactForAgent } from '../infrastructure/agentConfigInstallers'
import { mcpRegistryCatalogProvider } from '../infrastructure/mcpRegistryCatalogProvider'
import { ExtensionRuntime } from './extensionRuntime'

export interface ExtensionRepository {
  list(): InstalledExtensionRecord[]
  save(input: SaveExtensionInstallationInput): InstalledExtensionRecord
  get(id: string): InstalledExtensionRecord | null
  updateRuntimeState(input: UpdateExtensionRuntimeStateInput): InstalledExtensionRecord
  saveDoctorResult(input: SaveExtensionDoctorResultInput): InstalledExtensionRecord
}

export interface ExtensionCatalogProvider {
  list(query?: string): Promise<MarketplaceExtension[]>
}

export class ExtensionMarketplaceService {
  constructor(
    private readonly repository: ExtensionRepository = extensionsStore,
    private readonly catalog: readonly MarketplaceExtension[] = EXTENSION_CATALOG,
    private readonly catalogProviders: readonly ExtensionCatalogProvider[] = [
      mcpRegistryCatalogProvider,
    ],
    private readonly runtime: ExtensionRuntime = new ExtensionRuntime(repository),
  ) {}

  async listCatalog(): Promise<MarketplaceExtension[]> {
    return (await this.loadCatalog()).map(cloneExtension)
  }

  async searchCatalog(
    input: SearchMarketplaceExtensionsInput = {},
  ): Promise<MarketplaceCatalogSearchResult> {
    const query = input.query?.trim().toLowerCase()
    const categories = setFrom(input.categories)
    const sources = setFrom(input.sources)
    const targetAgents = setFrom(input.targetAgents)
    const tags = setFrom(input.tags?.map((tag) => tag.toLowerCase()))
    const limit = normalizeLimit(input.limit)
    const catalog = await this.loadCatalog(input.query)

    const items = catalog.filter((extension) => {
      if (query && !matchesQuery(extension, query)) return false
      if (categories.size > 0 && !categories.has(extension.category)) return false
      if (sources.size > 0 && !sources.has(extension.source)) return false
      if (
        targetAgents.size > 0 &&
        !extension.targetAgents.some((agentId) => targetAgents.has(agentId))
      ) {
        return false
      }
      if (tags.size > 0 && !extension.tags.some((tag) => tags.has(tag.toLowerCase()))) {
        return false
      }
      return true
    })

    return {
      items: items.slice(0, limit).map(cloneExtension),
      total: items.length,
      tags: sortedUnique(catalog.flatMap((extension) => extension.tags)),
      publishers: sortedUnique(catalog.map((extension) => extension.publisher)),
    }
  }

  listInstalled(): InstalledExtensionRecord[] {
    return this.repository.list()
  }

  async getState(): Promise<ExtensionMarketplaceState> {
    return {
      catalog: await this.listCatalog(),
      installed: this.listInstalled(),
    }
  }

  async install(input: InstallExtensionInput): Promise<InstalledExtensionRecord> {
    const extension =
      (await this.loadCatalog()).find((item) => item.id === input.extensionId) ??
      (await this.loadCatalog(externalCatalogQueryFromId(input.extensionId))).find(
        (item) => item.id === input.extensionId,
      )
    if (!extension) throw new Error(`Unknown extension: ${input.extensionId}`)
    if (extension.artifacts.length === 0 && !extension.executable) {
      throw new Error(`${extension.name} is a provider entry and cannot be installed directly.`)
    }
    if (extension.requiresProject && !input.projectPath?.trim()) {
      throw new Error(`${extension.name} requires a selected project path.`)
    }

    const targetAgents = resolveTargetAgents(input.targetAgents, extension.targetAgents)
    if (targetAgents.length === 0) {
      throw new Error(`No supported target agents selected for ${extension.name}.`)
    }
    const actions: ExtensionInstallAction[] = []

    for (const agentId of targetAgents) {
      for (const artifact of extension.artifacts) {
        actions.push(
          await installArtifactForAgent({
            artifact,
            agentId,
            scope: input.scope,
            projectPath: input.projectPath,
          }),
        )
      }
    }

    return this.repository.save({
      extensionId: extension.id,
      scope: input.scope,
      projectPath: input.projectPath,
      targetAgents,
      actions,
      installedAt: Date.now(),
      executableManifest: extension.executable,
    })
  }

  updateRuntimeState(input: UpdateExtensionRuntimeStateInput): InstalledExtensionRecord {
    return this.repository.updateRuntimeState(input)
  }

  async runDoctor(input: RunExtensionDoctorInput): Promise<InstalledExtensionRecord> {
    const installation = this.repository.get(input.installationId)
    if (!installation) throw new Error(`Extension installation not found: ${input.installationId}`)
    const result = await this.runtime.doctor(installation)
    const doctorResult: ExtensionDoctorResult = {
      status: result.status,
      message: result.message,
      checkedAt: Date.now(),
      ...(result.stderr ? { stderr: result.stderr } : {}),
    }
    return this.repository.saveDoctorResult({
      installationId: input.installationId,
      result: doctorResult,
    })
  }

  async decoratePrompt(input: {
    projectId: string
    projectPath: string
    prompt: string
    agentId: ExtensionTargetAgent | string
  }): Promise<string> {
    const executions = await this.runtime.runHook<
      typeof input,
      { prompt?: string; append?: string; prepend?: string }
    >(
      {
        hook: 'prompt-decoration',
        requiredCapabilities: ['prompt:decorate'],
        projectPath: input.projectPath,
      },
      input,
    )

    return executions.reduce((prompt, execution) => {
      const result = execution.result
      if (typeof result.prompt === 'string') return result.prompt
      return [result.prepend, prompt, result.append].filter(Boolean).join('\n')
    }, input.prompt)
  }

  async listReviewProviders(input: { projectPath?: string }): Promise<
    Array<{ installationId: string; extensionId: string; providers: string[]; stderr?: string }>
  > {
    const executions = await this.runtime.runHook<
      typeof input,
      { providers?: Array<string | { id?: string }> }
    >(
      {
        hook: 'review-provider-registration',
        requiredCapabilities: ['review-provider:register'],
        projectPath: input.projectPath,
      },
      input,
    )

    return executions.map((execution) => ({
      installationId: execution.installationId,
      extensionId: execution.extensionId,
      providers: normalizeProviderIds(execution.result.providers),
      ...(execution.stderr ? { stderr: execution.stderr } : {}),
    }))
  }

  async observeQualityGate(input: {
    projectId: string
    projectPath: string
    sessionId: string
    phase: string
    recipeId?: string
    command?: string
    exitCode?: number
  }): Promise<void> {
    await this.runtime.runHook(
      {
        hook: 'quality-gate-observation',
        requiredCapabilities: ['quality-gate:observe'],
        projectPath: input.projectPath,
      },
      input,
    )
  }

  async shouldAllowRetry(input: {
    projectId: string
    projectPath: string
    sessionId: string
    reason: string
    nextModel?: string
  }): Promise<{ allow: boolean; reason?: string }> {
    const executions = await this.runtime.runHook<typeof input, { allow?: boolean; reason?: string }>(
      {
        hook: 'retry-gating',
        requiredCapabilities: ['retry:gate'],
        projectPath: input.projectPath,
      },
      input,
    )
    const denial = executions.find((execution) => execution.result.allow === false)
    if (!denial) return { allow: true }
    return {
      allow: false,
      reason: denial.result.reason ?? `Retry blocked by ${denial.extensionId}.`,
    }
  }

  private async loadCatalog(query?: string): Promise<MarketplaceExtension[]> {
    const externalCatalogs = await Promise.all(
      this.catalogProviders.map((provider) => provider.list(query)),
    )
    return mergeCatalogs([...this.catalog, ...externalCatalogs.flat()])
  }
}

function normalizeProviderIds(providers: Array<string | { id?: string }> | undefined): string[] {
  if (!providers) return []
  return providers
    .map((provider) => (typeof provider === 'string' ? provider : provider.id))
    .filter((provider): provider is string => Boolean(provider?.trim()))
}

function matchesQuery(extension: MarketplaceExtension, query: string): boolean {
  const haystack = [
    extension.name,
    extension.summary,
    extension.description,
    extension.publisher,
    extension.category,
    extension.source,
    ...extension.tags,
    ...extension.artifacts.flatMap((artifact) => {
      if (artifact.kind === 'mcp-server') return [artifact.serverName]
      if (artifact.kind === 'plugin') return [artifact.packageName]
      return [
        artifact.skillName,
        'packageName' in artifact ? artifact.packageName : '',
        'cliSkillName' in artifact ? (artifact.cliSkillName ?? '') : '',
      ]
    }),
    ...(extension.executable?.hooks ?? []),
    ...(extension.executable?.capabilities ?? []),
    extension.executable?.runtime ?? '',
    extension.executable?.command ?? '',
  ]
  return haystack.some((value) => value.toLowerCase().includes(query))
}

function setFrom<T extends string>(values: readonly T[] | undefined): Set<T> {
  return new Set(values ?? [])
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return Number.POSITIVE_INFINITY
  return Math.max(1, Math.min(100, Math.floor(value)))
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function mergeCatalogs(catalog: readonly MarketplaceExtension[]): MarketplaceExtension[] {
  const byId = new Map<string, MarketplaceExtension>()
  for (const extension of catalog) {
    if (!byId.has(extension.id)) byId.set(extension.id, extension)
  }
  return [...byId.values()]
}

function externalCatalogQueryFromId(extensionId: string): string | undefined {
  return extensionId.startsWith('mcp-registry:')
    ? extensionId.slice('mcp-registry:'.length)
    : undefined
}

function resolveTargetAgents(
  requested: readonly ExtensionTargetAgent[] | undefined,
  supported: readonly ExtensionTargetAgent[],
): ExtensionTargetAgent[] {
  const source = requested?.length ? requested : supported
  const allowed = new Set(supported)
  return [...new Set(source.filter((agentId) => allowed.has(agentId)))]
}

function cloneExtension(extension: MarketplaceExtension): MarketplaceExtension {
  return structuredClone(extension)
}

export const extensionMarketplaceService = new ExtensionMarketplaceService()
