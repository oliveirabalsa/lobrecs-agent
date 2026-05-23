import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  ExtensionCatalogKind,
  ExtensionCatalogSource,
  ExtensionInstallScope,
  ExtensionTargetAgent,
  InstalledExtensionRecord,
  MarketplaceCatalogSearchResult,
  MarketplaceExtension,
  Project,
} from '../../../../shared/types'
import { AGENT_LABELS } from '../../../../shared/types'

interface ExtensionMarketplaceProps {
  selectedProject: Project | null
  compact?: boolean
}

const targetAgents: ExtensionTargetAgent[] = ['claude-code', 'codex', 'opencode']
const categories: Array<{ id: ExtensionCatalogKind | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'plugin', label: 'Plugins' },
  { id: 'skill', label: 'Skills' },
  { id: 'mcp-server', label: 'MCPs' },
  { id: 'provider', label: 'Providers' },
]
const sourceOptions: Array<{ id: ExtensionCatalogSource | 'all'; label: string }> = [
  { id: 'all', label: 'All sources' },
  { id: 'official', label: 'Official' },
  { id: 'curated', label: 'Curated' },
  { id: 'community', label: 'Community' },
  { id: 'external', label: 'External' },
]

export function ExtensionMarketplace({
  selectedProject,
  compact = false,
}: ExtensionMarketplaceProps) {
  const [installed, setInstalled] = useState<InstalledExtensionRecord[]>([])
  const [catalog, setCatalog] = useState<MarketplaceCatalogSearchResult | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ExtensionCatalogKind | 'all'>('all')
  const [source, setSource] = useState<ExtensionCatalogSource | 'all'>('all')
  const [target, setTarget] = useState<ExtensionTargetAgent | 'all'>('all')
  const [scope, setScope] = useState<ExtensionInstallScope>(() =>
    selectedProject ? 'project' : 'global',
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadInstalled = useCallback(async () => {
    setInstalled(await window.agentforge.extensions.listInstalled())
  }, [])

  const searchCatalog = useCallback(async () => {
    const result = await window.agentforge.extensions.searchCatalog({
      query,
      categories: category === 'all' ? undefined : [category],
      sources: source === 'all' ? undefined : [source],
      targetAgents: target === 'all' ? undefined : [target],
      limit: 100,
    })
    setCatalog(result)
    setSelectedId((current) => current ?? result.items[0]?.id ?? null)
  }, [category, query, source, target])

  useEffect(() => {
    void Promise.all([
      loadInstalled().catch((reason) => {
        setError(reason instanceof Error ? reason.message : 'Failed to load installs.')
      }),
      searchCatalog().catch((reason) => {
        setError(reason instanceof Error ? reason.message : 'Failed to load marketplace.')
      }),
    ])
  }, [loadInstalled, searchCatalog])

  useEffect(() => {
    if (!selectedProject && scope === 'project') setScope('global')
  }, [scope, selectedProject])

  useEffect(() => {
    if (!catalog?.items.length) {
      setSelectedId(null)
      return
    }
    if (selectedId && catalog.items.some((extension) => extension.id === selectedId)) return
    setSelectedId(catalog.items[0].id)
  }, [catalog?.items, selectedId])

  const latestByExtension = useMemo(() => {
    const records = new Map<string, InstalledExtensionRecord>()
    for (const record of installed) {
      if (!records.has(record.extensionId)) records.set(record.extensionId, record)
    }
    return records
  }, [installed])

  const selectedExtension = useMemo(
    () => catalog?.items.find((extension) => extension.id === selectedId) ?? catalog?.items[0] ?? null,
    [catalog?.items, selectedId],
  )

  const featured = useMemo(
    () => catalog?.items.filter((extension) => extension.featured).slice(0, 3) ?? [],
    [catalog?.items],
  )

  const install = useCallback(
    async (extension: MarketplaceExtension) => {
      setInstallingId(extension.id)
      setError(null)
      setNotice(null)

      try {
        const allowedTargets =
          target === 'all'
            ? extension.targetAgents
            : extension.targetAgents.includes(target)
              ? [target]
              : []
        const result = await window.agentforge.extensions.install({
          extensionId: extension.id,
          scope,
          projectPath: scope === 'project' ? selectedProject?.repoPath : undefined,
          targetAgents: allowedTargets,
        })
        const applied = result.actions.filter((action) => action.status !== 'skipped').length
        const skipped = result.actions.length - applied
        setNotice(
          `${extension.name}: ${applied} action${applied === 1 ? '' : 's'} applied${
            skipped ? `, ${skipped} skipped` : ''
          }.`,
        )
        await loadInstalled()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Failed to install extension.')
      } finally {
        setInstallingId(null)
      }
    },
    [loadInstalled, scope, selectedProject?.repoPath, target],
  )

  const items = catalog?.items ?? []
  const total = catalog?.total ?? 0

  return (
    <div className={`flex min-h-0 flex-1 flex-col bg-canvas ${compact ? '' : 'overflow-hidden'}`}>
      <div className="shrink-0 border-b border-hairline px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-normal text-primary">Extensions</h1>
            <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted">
              Install plugins, skills, MCP servers, and external provider catalogs for the agents in this workspace.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              value={scope}
              options={[
                { id: 'project', label: 'Project', disabled: !selectedProject },
                { id: 'global', label: 'Global' },
              ]}
              onChange={(value) => setScope(value as ExtensionInstallScope)}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div className="flex rounded-card border border-hairline bg-card p-0.5">
            {categories.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setCategory(item.id)}
                className={`rounded px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  category === item.id
                    ? 'bg-white/10 text-primary'
                    : 'text-muted hover:text-secondary'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="flex h-9 items-center gap-2 rounded-card border border-hairline bg-card px-3 text-secondary focus-within:border-hairline-strong">
              <SearchIcon />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search extensions"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-primary outline-none placeholder:text-muted"
              />
            </label>
          </div>
          <SelectControl
            label="Source"
            value={source}
            options={sourceOptions}
            onChange={(value) => setSource(value as ExtensionCatalogSource | 'all')}
          />
          <SelectControl
            label="Agent"
            value={target}
            options={[
              { id: 'all', label: 'All agents' },
              ...targetAgents.map((agentId) => ({ id: agentId, label: AGENT_LABELS[agentId] })),
            ]}
            onChange={(value) => setTarget(value as ExtensionTargetAgent | 'all')}
          />
        </div>
      </div>

      {error ? (
        <div className="shrink-0 border-b border-accent-del/40 bg-accent-del/10 px-5 py-2 text-[12px] text-accent-del">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="shrink-0 border-b border-accent-add/40 bg-accent-add/10 px-5 py-2 text-[12px] text-accent-add">
          {notice}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="min-h-0 overflow-y-auto px-5 py-5">
          {catalog ? (
            <>
              {featured.length > 0 ? (
                <div className="mb-5 grid gap-3 lg:grid-cols-3">
                  {featured.map((extension) => (
                    <FeaturedExtension
                      key={extension.id}
                      extension={extension}
                      active={selectedExtension?.id === extension.id}
                      installed={Boolean(latestByExtension.get(extension.id))}
                      onSelect={() => setSelectedId(extension.id)}
                    />
                  ))}
                </div>
              ) : null}

              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-[14px] font-semibold text-primary">Marketplace</h2>
                <span className="text-[11px] text-muted">
                  {total} result{total === 1 ? '' : 's'}
                </span>
              </div>

              {items.length > 0 ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  {items.map((extension) => (
                    <ExtensionCard
                      key={extension.id}
                      extension={extension}
                      active={selectedExtension?.id === extension.id}
                      installed={Boolean(latestByExtension.get(extension.id))}
                      onSelect={() => setSelectedId(extension.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-card border border-dashed border-hairline px-4 py-10 text-center text-[12px] text-muted">
                  No extensions match the current filters.
                </div>
              )}
            </>
          ) : (
            <div className="text-[12px] text-muted">Loading marketplace...</div>
          )}
        </section>

        <ExtensionDetail
          extension={selectedExtension}
          latest={selectedExtension ? latestByExtension.get(selectedExtension.id) : undefined}
          scope={scope}
          selectedProject={selectedProject}
          target={target}
          installing={installingId === selectedExtension?.id}
          onInstall={(extension) => void install(extension)}
        />
      </div>
    </div>
  )
}

function FeaturedExtension({
  extension,
  active,
  installed,
  onSelect,
}: {
  extension: MarketplaceExtension
  active: boolean
  installed: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`min-h-36 rounded-card border p-4 text-left transition-colors ${
        active
          ? 'border-accent-primary/60 bg-accent-primary/10'
          : 'border-hairline bg-card hover:border-white/15 hover:bg-card-raised'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <ExtensionIcon category={extension.category} />
        {installed ? <CheckIcon /> : null}
      </div>
      <div className="mt-4 text-[14px] font-semibold text-primary">{extension.name}</div>
      <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted">{extension.summary}</div>
    </button>
  )
}

function ExtensionCard({
  extension,
  active,
  installed,
  onSelect,
}: {
  extension: MarketplaceExtension
  active: boolean
  installed: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid min-h-32 grid-cols-[42px_minmax(0,1fr)_auto] gap-3 rounded-card border px-4 py-3 text-left transition-colors ${
        active
          ? 'border-accent-primary/60 bg-accent-primary/10'
          : 'border-hairline bg-card hover:border-white/15 hover:bg-card-raised'
      }`}
    >
      <ExtensionIcon category={extension.category} />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-primary">{extension.name}</span>
          <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted">
            {categoryLabel(extension.category)}
          </span>
        </span>
        <span className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted">
          {extension.summary}
        </span>
        <span className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded border border-hairline bg-canvas px-1.5 py-0.5 text-[10px] text-secondary">
            {extension.publisher}
          </span>
          {extension.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted">
              {tag}
            </span>
          ))}
        </span>
      </span>
      <span className="pt-0.5 text-muted">{installed ? <CheckIcon /> : <PlusIcon />}</span>
    </button>
  )
}

function ExtensionDetail({
  extension,
  latest,
  scope,
  selectedProject,
  target,
  installing,
  onInstall,
}: {
  extension: MarketplaceExtension | null
  latest?: InstalledExtensionRecord
  scope: ExtensionInstallScope
  selectedProject: Project | null
  target: ExtensionTargetAgent | 'all'
  installing: boolean
  onInstall: (extension: MarketplaceExtension) => void
}) {
  if (!extension) {
    return (
      <aside className="hidden border-l border-hairline px-5 py-5 xl:block">
        <div className="text-[12px] text-muted">Select an extension to inspect it.</div>
      </aside>
    )
  }

  const allowedTargets =
    target === 'all'
      ? extension.targetAgents
      : extension.targetAgents.includes(target)
        ? [target]
        : []
  const providerOnly = extension.artifacts.length === 0
  const unsupportedRecipe = extension.category !== 'provider' && extension.artifacts.length === 0
  const missingProject = extension.requiresProject && !selectedProject
  const disabled = providerOnly || missingProject || allowedTargets.length === 0 || installing

  return (
    <aside className="min-h-0 overflow-y-auto border-t border-hairline px-5 py-5 xl:border-l xl:border-t-0">
      <div className="flex items-start gap-3">
        <ExtensionIcon category={extension.category} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-semibold text-primary">{extension.name}</h2>
            {extension.recommended ? (
              <span className="rounded border border-accent-add/40 bg-accent-add/10 px-1.5 py-0.5 text-[10px] text-accent-add">
                Recommended
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-[12px] text-muted">{extension.publisher}</div>
        </div>
      </div>

      <p className="mt-5 text-[13px] leading-6 text-secondary">{extension.description}</p>

      <div className="mt-5 grid gap-3">
        <DetailBlock label="Compatibility">
          <div className="flex flex-wrap gap-1.5">
            {extension.targetAgents.map((agentId) => (
              <span
                key={agentId}
                className="rounded border border-hairline bg-card px-2 py-1 text-[11px] text-secondary"
              >
                {AGENT_LABELS[agentId]}
              </span>
            ))}
          </div>
        </DetailBlock>

        <DetailBlock label="Install plan">
          <div className="grid gap-2">
            {extension.artifacts.length > 0 ? (
              extension.artifacts.map((artifact, index) => (
                <div
                  key={`${artifact.kind}-${index}`}
                  className="rounded border border-hairline bg-card px-3 py-2 text-[11px] text-secondary"
                >
                  <div className="font-medium text-primary">{artifactLabel(artifact.kind)}</div>
                  <div className="mt-1 font-mono text-muted">
                    {artifactIdentifier(artifact)}
                  </div>
                  {artifact.kind === 'skill' && 'packageName' in artifact ? (
                    <div className="mt-2 break-all font-mono text-[10px] leading-4 text-muted">
                      {skillsCliPreview(artifact.packageName, artifact.cliSkillName)}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="text-[12px] text-muted">
                {unsupportedRecipe ? 'Install recipe unavailable.' : 'Provider catalog entry.'}
              </div>
            )}
          </div>
        </DetailBlock>

        {extension.setupNotes?.length ? (
          <DetailBlock label="Setup">
            <ul className="grid gap-1.5 text-[12px] leading-5 text-muted">
              {extension.setupNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </DetailBlock>
        ) : null}

        {extension.permissions?.length ? (
          <DetailBlock label="Permissions">
            <ul className="grid gap-1.5 text-[12px] leading-5 text-muted">
              {extension.permissions.map((permission) => (
                <li key={permission}>{permission}</li>
              ))}
            </ul>
          </DetailBlock>
        ) : null}

        {latest ? (
          <DetailBlock label="Installed">
            <div className="text-[12px] leading-5 text-muted">
              {new Date(latest.installedAt).toLocaleString()} · {latest.scope}
            </div>
          </DetailBlock>
        ) : null}
      </div>

      <div className="sticky bottom-0 mt-6 border-t border-hairline bg-canvas pt-4">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onInstall(extension)}
          className="h-9 w-full rounded-card bg-accent-primary px-3 text-[13px] font-semibold text-white transition-colors hover:bg-accent-primary/85 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {installing
            ? 'Installing...'
            : unsupportedRecipe
              ? 'Install recipe unavailable'
              : providerOnly
              ? 'Provider sync pending'
              : latest
                ? 'Reinstall'
                : 'Install'}
        </button>
        {missingProject ? (
          <div className="mt-2 text-[11px] leading-5 text-accent-warn">
            Select a project to install this extension.
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function DetailBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </h3>
      {children}
    </section>
  )
}

function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string
  options: Array<{ id: string; label: string; disabled?: boolean }>
  onChange: (value: string) => void
}) {
  return (
    <div className="flex rounded-card border border-hairline bg-card p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={option.disabled}
          onClick={() => onChange(option.id)}
          className={`rounded px-3 py-1.5 text-[12px] font-medium transition-colors ${
            value === option.id
              ? 'bg-white/10 text-primary'
              : 'text-muted hover:text-secondary disabled:cursor-not-allowed disabled:opacity-40'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ id: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-card border border-hairline bg-card px-2.5">
      <span className="text-[11px] text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent text-[12px] text-secondary outline-none"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function ExtensionIcon({ category }: { category: ExtensionCatalogKind }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-hairline bg-canvas text-secondary">
      {category === 'plugin' ? (
        <PluginGlyph />
      ) : category === 'skill' ? (
        <SkillGlyph />
      ) : category === 'provider' ? (
        <ProviderGlyph />
      ) : (
        <McpGlyph />
      )}
    </span>
  )
}

function categoryLabel(category: ExtensionCatalogKind): string {
  if (category === 'mcp-server') return 'MCP'
  return category
}

function artifactLabel(kind: string): string {
  if (kind === 'mcp-server') return 'MCP server'
  if (kind === 'skill') return 'Skill'
  return 'Plugin'
}

function artifactIdentifier(extension: MarketplaceExtension['artifacts'][number]): string {
  if (extension.kind === 'mcp-server') return extension.serverName
  if (extension.kind === 'plugin') return extension.packageName
  return 'packageName' in extension
    ? `${extension.packageName} / ${extension.cliSkillName ?? extension.skillName}`
    : extension.skillName
}

function skillsCliPreview(packageName: string, skillName?: string): string {
  return ['npx skills add', packageName, skillName ? `--skill ${skillName}` : '']
    .filter(Boolean)
    .join(' ')
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PluginGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 4h8v5h4v6h-4v5H8v-5H4V9h4V4z" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

function SkillGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v8M8 10l4-2 4 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function McpGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 8a4 4 0 1 1 5 3.87V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17 16a4 4 0 1 1-5-3.87V8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

function ProviderGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 5v14M17 5v14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
