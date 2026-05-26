import { readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentModelCatalog,
  AgentProfile,
  AgentProfileDoctorReport,
  AgentProfileIssue,
  AgentProfileListResult,
  AgentProfileVerificationPreferences,
  AdapterCapability,
  SupportedAgentId,
} from '../../../../shared/types'
import {
  AGENT_LABELS,
  AGENT_PROFILE_APPROVAL_MODES,
  AGENT_PROFILE_THINKING_LEVELS,
  SUPPORTED_AGENT_IDS,
} from '../../../../shared/types'
import { requireProject } from '../../projects/application/requireProject'

type FrontmatterValue = string | string[] | boolean
type Frontmatter = Record<string, FrontmatterValue>

export async function listAgentProfiles(input: {
  projectId: string
  capabilities: AdapterCapability[]
  modelCatalogs: AgentModelCatalog[]
}): Promise<AgentProfileListResult> {
  const project = requireProject(input.projectId)
  const { profiles, issues: loadIssues } = await loadProjectAgentProfiles(project.repoPath)
  const validationIssues = validateProfiles(profiles, {
    capabilities: input.capabilities,
    modelCatalogs: input.modelCatalogs,
    repoPath: project.repoPath,
  })

  return {
    projectId: project.id,
    profiles,
    issues: [...loadIssues, ...validationIssues],
  }
}

export async function getAgentProfile(
  projectId: string,
  profileId: string | undefined,
): Promise<AgentProfile | null> {
  if (!profileId) return null
  const project = requireProject(projectId)
  const { profiles } = await loadProjectAgentProfiles(project.repoPath)
  return profiles.find((profile) => profile.id === profileId) ?? null
}

export async function getAgentProfileDoctorReport(input: {
  projectId: string
  capabilities: AdapterCapability[]
  modelCatalogs: AgentModelCatalog[]
}): Promise<AgentProfileDoctorReport> {
  const result = await listAgentProfiles(input)
  return {
    projectId: result.projectId,
    profileCount: result.profiles.length,
    issues: result.issues,
  }
}

export function promptWithAgentProfile(
  prompt: string,
  profile: AgentProfile | null,
): string {
  if (!profile) return prompt

  const lines = [
    `[Agent Profile: ${profile.name}]`,
    `Role: ${profile.role}`,
    '',
    profile.instructions.trim(),
  ]

  if (profile.allowedTools.length > 0) {
    lines.push('', `Allowed tools: ${profile.allowedTools.join(', ')}`)
  }

  if (profile.mcpRefs.length > 0) {
    lines.push('', `Scoped MCP refs: ${profile.mcpRefs.join(', ')}`)
  }

  if (profile.verification.recipeIds.length > 0) {
    lines.push('', `Preferred verification recipes: ${profile.verification.recipeIds.join(', ')}`)
  }

  lines.push('', 'User task:', prompt.trim())
  return lines.filter((line) => line !== undefined).join('\n')
}

export function applyProfileToSwarmAgent(
  agentConfig: {
    profileId?: string
    role: string
    agentId: SupportedAgentId
    modelOverride?: string
    promptSuffix?: string
  },
  profile: AgentProfile | null,
): typeof agentConfig {
  if (!profile) return agentConfig

  return {
    ...agentConfig,
    role: agentConfig.role.trim() || profile.role,
    agentId: agentConfig.agentId ?? profile.defaultAgentId ?? 'codex',
    modelOverride: agentConfig.modelOverride ?? profile.defaultModel,
    promptSuffix: [profile.instructions.trim(), agentConfig.promptSuffix?.trim()]
      .filter(Boolean)
      .join('\n\n') || undefined,
  }
}

async function loadProjectAgentProfiles(
  repoPath: string,
): Promise<{ profiles: AgentProfile[]; issues: AgentProfileIssue[] }> {
  const profilesDir = path.join(repoPath, '.lobrecs', 'agents')
  const issues: AgentProfileIssue[] = []

  let entries
  try {
    entries = await readdir(profilesDir, { withFileTypes: true })
  } catch (error: unknown) {
    if (isMissingPath(error)) return { profiles: [], issues: [] }
    throw error
  }

  const profiles: AgentProfile[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const id = normalizeProfileId(entry.name)
    const filePath = path.join(profilesDir, entry.name, 'AGENT.md')

    try {
      const markdown = await readFile(filePath, 'utf8')
      const mcpConfigPath = path.join(profilesDir, entry.name, 'mcp.json')
      const mcpServerNames = await readMcpServerNames(mcpConfigPath)
      profiles.push(parseAgentProfile({ id, filePath, markdown, mcpConfigPath, mcpServerNames }))
    } catch (error: unknown) {
      if (isMissingPath(error)) continue
      issues.push({
        profileId: id,
        profileName: entry.name,
        kind: 'invalid-profile',
        message: error instanceof Error ? error.message : 'Profile could not be loaded.',
      })
    }
  }

  profiles.sort((a, b) => a.name.localeCompare(b.name))
  return { profiles, issues }
}

function parseAgentProfile(input: {
  id: string
  filePath: string
  markdown: string
  mcpConfigPath: string
  mcpServerNames: string[]
}): AgentProfile {
  const { frontmatter, body } = splitFrontmatter(input.markdown)
  const name = stringValue(frontmatter.name) ?? titleFromId(input.id)
  const role = stringValue(frontmatter.role) ?? name
  const agentId = supportedAgentId(stringValue(frontmatter.agentId))
  const approvalMode = approvalModeValue(stringValue(frontmatter.approvalMode))
  const thinking = thinkingValue(stringValue(frontmatter.thinking))
  const allowedTools = stringArrayValue(frontmatter.allowedTools)
  const mcpRefs = stringArrayValue(frontmatter.mcpRefs)
  const verification = verificationPreferences(frontmatter)
  const instructions = body.trim()

  if (!instructions) {
    throw new Error(`Agent profile ${name} must include markdown instructions.`)
  }

  return {
    id: input.id,
    name,
    role,
    instructions,
    ...(agentId ? { defaultAgentId: agentId } : {}),
    ...(stringValue(frontmatter.model) ? { defaultModel: stringValue(frontmatter.model) } : {}),
    ...(approvalMode ? { approvalMode } : {}),
    ...(thinking ? { thinking } : {}),
    allowedTools,
    mcpRefs,
    mcpServerNames: input.mcpServerNames,
    verification,
    filePath: input.filePath,
    ...(input.mcpServerNames.length > 0 ? { mcpConfigPath: input.mcpConfigPath } : {}),
  }
}

function validateProfiles(
  profiles: AgentProfile[],
  context: {
    capabilities: AdapterCapability[]
    modelCatalogs: AgentModelCatalog[]
    repoPath: string
  },
): AgentProfileIssue[] {
  const issues: AgentProfileIssue[] = []
  const repoMcpServers = readKnownProjectMcpServerNames(context.repoPath)

  for (const profile of profiles) {
    const capability = profile.defaultAgentId
      ? context.capabilities.find((item) => item.agentId === profile.defaultAgentId)
      : null

    if (profile.defaultAgentId && !capability?.installed) {
      issues.push(issue(profile, 'missing-agent-runtime', `${AGENT_LABELS[profile.defaultAgentId]} is not installed.`))
    }

    if (profile.approvalMode && capability && !capability.supportsApprovalMode) {
      issues.push(issue(profile, 'unsupported-approval-mode', `${capability.name} does not support approval mode overrides.`))
    }

    if (profile.defaultAgentId && profile.defaultModel) {
      const catalog = context.modelCatalogs.find((item) => item.agentId === profile.defaultAgentId)
      const hasModel = catalog?.models.some((model) => model.id === profile.defaultModel)
      if (catalog?.installed && catalog.models.length > 0 && !hasModel) {
        issues.push(issue(profile, 'unavailable-model', `Model ${profile.defaultModel} is not listed for ${catalog.name}.`, profile.defaultModel))
      }
    }

    for (const ref of profile.mcpRefs) {
      if (!profile.mcpServerNames.includes(ref) && !repoMcpServers.includes(ref)) {
        issues.push(issue(profile, 'missing-mcp-server', `MCP server ${ref} is not configured for this profile or project.`, ref))
      }
    }
  }

  return issues
}

function issue(
  profile: AgentProfile,
  kind: AgentProfileIssue['kind'],
  message: string,
  ref?: string,
): AgentProfileIssue {
  return {
    profileId: profile.id,
    profileName: profile.name,
    kind,
    message,
    ...(ref ? { ref } : {}),
  }
}

function splitFrontmatter(markdown: string): { frontmatter: Frontmatter; body: string } {
  if (!markdown.startsWith('---\n')) return { frontmatter: {}, body: markdown }
  const end = markdown.indexOf('\n---', 4)
  if (end === -1) return { frontmatter: {}, body: markdown }

  return {
    frontmatter: parseSimpleYaml(markdown.slice(4, end)),
    body: markdown.slice(end + 4),
  }
}

function parseSimpleYaml(source: string): Frontmatter {
  const result: Frontmatter = {}
  let activeArrayKey: string | null = null

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    if (activeArrayKey && line.startsWith('- ')) {
      const current = result[activeArrayKey]
      result[activeArrayKey] = [...(Array.isArray(current) ? current : []), unquote(line.slice(2).trim())]
      continue
    }

    activeArrayKey = null
    const separator = line.indexOf(':')
    if (separator === -1) continue

    const key = line.slice(0, separator).trim()
    const rawValue = line.slice(separator + 1).trim()
    if (!key) continue

    if (!rawValue) {
      result[key] = []
      activeArrayKey = key
      continue
    }

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      result[key] = rawValue
        .slice(1, -1)
        .split(',')
        .map((item) => unquote(item.trim()))
        .filter(Boolean)
      continue
    }

    if (rawValue === 'true' || rawValue === 'false') {
      result[key] = rawValue === 'true'
      continue
    }

    result[key] = unquote(rawValue)
  }

  return result
}

async function readMcpServerNames(filePath: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    return mcpServerNamesFromConfig(parsed)
  } catch (error: unknown) {
    if (isMissingPath(error)) return []
    throw new Error(`Invalid MCP config at ${filePath}.`)
  }
}

function readKnownProjectMcpServerNames(repoPath: string): string[] {
  try {
    const configPath = path.join(repoPath, '.mcp.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as unknown
    return mcpServerNamesFromConfig(config)
  } catch {
    return []
  }
}

function mcpServerNamesFromConfig(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  return [
    ...keysFromRecord(record.mcpServers),
    ...keysFromRecord(record.mcp),
    ...keysFromRecord(record.mcp_servers),
  ]
}

function keysFromRecord(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.keys(value as Record<string, unknown>)
}

function verificationPreferences(frontmatter: Frontmatter): AgentProfileVerificationPreferences {
  return {
    recipeIds: stringArrayValue(frontmatter.verificationRecipeIds),
    requireCommandPrefix:
      typeof frontmatter.requireCommandPrefix === 'boolean'
        ? frontmatter.requireCommandPrefix
        : undefined,
  }
}

function normalizeProfileId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent'
}

function titleFromId(value: string): string {
  return value
    .split(/[-_.:]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Agent'
}

function stringValue(value: FrontmatterValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringArrayValue(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function supportedAgentId(value: string | undefined): SupportedAgentId | undefined {
  return SUPPORTED_AGENT_IDS.includes(value as SupportedAgentId)
    ? (value as SupportedAgentId)
    : undefined
}

function approvalModeValue(value: string | undefined): AgentProfile['approvalMode'] {
  if (!value) return undefined
  return AGENT_PROFILE_APPROVAL_MODES.includes(value as Exclude<AgentProfile['approvalMode'], undefined>)
    ? (value as AgentProfile['approvalMode'])
    : undefined
}

function thinkingValue(value: string | undefined): AgentProfile['thinking'] {
  if (!value) return undefined
  return AGENT_PROFILE_THINKING_LEVELS.includes(value as Exclude<AgentProfile['thinking'], undefined>)
    ? (value as AgentProfile['thinking'])
    : undefined
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'ENOENT')
}
