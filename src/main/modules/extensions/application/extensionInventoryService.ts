import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { MainIpcContext } from '../../shared/ipcContext'
import type { InstalledExtensionInventoryItem } from '../../../../shared/contracts/system'
import { commandExists } from '../../../agents/command'
import { requireProject } from '../../projects/application/requireProject'
import { EXTENSION_CATALOG } from '../domain/catalog'

const KNOWN_MCP_TOOLS: Record<string, string[]> = {
  playwright: ['navigate', 'click', 'fill', 'select', 'hover', 'evaluate', 'screenshot'],
  filesystem: ['read_file', 'write_file', 'create_directory', 'list_directory', 'move_file', 'search_grep', 'get_file_info'],
  sequential_thinking: ['sequential_thinking'],
  memory: ['create_entities', 'read_graph', 'search_nodes', 'write_nodes', 'delete_nodes'],
  openaiDeveloperDocs: ['search_docs', 'get_doc_page'],
  context7: ['search_libraries', 'get_library_docs']
}

export class ExtensionInventoryService {
  constructor(private readonly context: MainIpcContext) {}

  async listInventory(projectId?: string): Promise<InstalledExtensionInventoryItem[]> {
    const inventory: InstalledExtensionInventoryItem[] = []
    const project = projectId ? requireProject(projectId) : null

    // 1. Get installed extensions from extensionsStore (SQLite)
    const installedRecords = this.context.extensionMarketplaceService.listInstalled()

    // 2. Scan active MCP servers from configuration files
    const mcpServers = await this.scanMcpConfigs(project?.repoPath)

    // Build map of catalog items by serverName and extensionId
    const catalogMap = new Map<string, typeof EXTENSION_CATALOG[number]>()
    for (const item of EXTENSION_CATALOG) {
      catalogMap.set(item.id, item)
      for (const artifact of item.artifacts) {
        if (artifact.kind === 'mcp-server') {
          catalogMap.set(`mcp:${artifact.serverName}`, item)
        }
      }
    }

    // Keep track of processed MCP servers to avoid duplication
    const processedMcpKeys = new Set<string>()

    // Add scanned MCP servers to inventory
    for (const server of mcpServers) {
      const key = `${server.agentId}:${server.name}:${server.scope}`
      if (processedMcpKeys.has(key)) continue
      processedMcpKeys.add(key)

      // Correlate with SQLite installed records or catalog
      const relatedRecord = installedRecords.find((rec) => {
        const catalogItem = catalogMap.get(rec.extensionId)
        return (
          catalogItem?.artifacts.some(
            (art) => art.kind === 'mcp-server' && art.serverName === server.name
          ) && rec.scope === server.scope
        )
      })

      const catalogItem = catalogMap.get(`mcp:${server.name}`) || (relatedRecord ? catalogMap.get(relatedRecord.extensionId) : null)

      // Resolve health
      let health: 'passed' | 'warning' | 'failed' = 'passed'
      let healthMessage = 'Healthy'
      if (server.transport === 'stdio' && server.command) {
        const exists = await commandExists(server.command)
        if (!exists) {
          health = 'failed'
          healthMessage = `Executable "${server.command}" not found on PATH`
        }
      } else if (server.transport === 'http' && server.url) {
        try {
          new URL(server.url)
        } catch {
          health = 'failed'
          healthMessage = `Invalid HTTP transport URL: "${server.url}"`
        }
      }

      // Check auth state
      let authState: 'none' | 'configured' | 'missing-credentials' = 'none'
      let isSecretRedacted = false

      // Check environment variables
      if (server.env) {
        for (const [k, v] of Object.entries(server.env)) {
          if (this.isSecretKey(k) && v) {
            authState = 'configured'
            isSecretRedacted = true
          }
        }
      }

      // Check headers
      if (server.headers) {
        for (const [k, v] of Object.entries(server.headers)) {
          if (this.isSecretKey(k) && v) {
            authState = 'configured'
            isSecretRedacted = true
          }
        }
      }

      // Check arguments
      if (server.args) {
        for (const arg of server.args) {
          if (this.isSecretArg(arg)) {
            authState = 'configured'
            isSecretRedacted = true
          }
        }
      }

      // Exposed tools
      const exposedTools = KNOWN_MCP_TOOLS[server.name] || catalogItem?.permissions || []

      // Redact details
      const redactedEnv: Record<string, string> = {}
      if (server.env) {
        for (const [k, v] of Object.entries(server.env)) {
          redactedEnv[k] = this.isSecretKey(k) ? '[REDACTED_SECRET]' : this.redactIfLooksLikeSecret(v)
        }
      }

      const redactedHeaders: Record<string, string> = {}
      if (server.headers) {
        for (const [k, v] of Object.entries(server.headers)) {
          redactedHeaders[k] = this.isSecretKey(k) ? '[REDACTED_SECRET]' : this.redactIfLooksLikeSecret(v)
        }
      }

      const redactedArgs = server.args?.map((arg) => {
        if (arg.startsWith('sk-') || arg.startsWith('pat-') || arg.startsWith('ghp_')) {
          return '[REDACTED_SECRET]'
        }
        const parts = arg.split('=')
        if (parts.length === 2) {
          const [k, v] = parts
          if (this.isSecretKey(k)) {
            return `${k}=[REDACTED_SECRET]`
          }
          return `${k}=${this.redactIfLooksLikeSecret(v)}`
        }
        return this.redactIfLooksLikeSecret(arg)
      })

      inventory.push({
        id: relatedRecord?.id || `mcp:${server.agentId}:${server.name}:${server.scope}`,
        name: catalogItem?.name || this.displayNameFromServerName(server.name),
        agentId: server.agentId,
        category: 'mcp-server',
        scope: server.scope,
        health,
        healthMessage,
        authState,
        exposedTools,
        isSecretRedacted,
        details: {
          command: server.command,
          args: redactedArgs,
          url: server.url,
          env: Object.keys(redactedEnv).length > 0 ? redactedEnv : undefined,
          headers: Object.keys(redactedHeaders).length > 0 ? redactedHeaders : undefined,
          filePath: server.filePath
        }
      })
    }

    // Add skills and plugins from SQLite installed records
    for (const record of installedRecords) {
      const catalogItem = catalogMap.get(record.extensionId)
      if (!catalogItem || catalogItem.category === 'mcp-server') continue

      // Check if it's a skill
      if (catalogItem.category === 'skill') {
        let health: 'passed' | 'warning' | 'failed' = 'passed'
        let healthMessage = 'Healthy'
        let filePath: string | undefined

        // Verify if skill file exists on disk
        const artifact = catalogItem.artifacts[0]
        if (artifact && artifact.kind === 'skill') {
          const base =
            record.scope === 'project' && project
              ? path.join(project.repoPath, '.codex/skills')
              : path.join(homedir(), '.codex/skills')
          filePath = path.join(base, artifact.skillName, 'SKILL.md')
          try {
            await fs.stat(filePath)
          } catch {
            health = 'failed'
            healthMessage = `Skill file missing at "${filePath}"`
          }
        }

        inventory.push({
          id: record.id,
          name: catalogItem.name,
          agentId: record.targetAgents.join(', '),
          category: 'skill',
          scope: record.scope,
          health,
          healthMessage,
          authState: 'none',
          exposedTools: [],
          isSecretRedacted: false,
          details: { filePath }
        })
      }

      // Check if it's a plugin
      if (catalogItem.category === 'plugin') {
        inventory.push({
          id: record.id,
          name: catalogItem.name,
          agentId: record.targetAgents.join(', '),
          category: 'plugin',
          scope: record.scope,
          health: 'passed',
          healthMessage: 'Plugin registered',
          authState: 'none',
          exposedTools: [],
          isSecretRedacted: false
        })
      }
    }

    return inventory
  }

  private isSecretKey(key: string): boolean {
    return /key|token|secret|password|auth|pat|jwt/i.test(key)
  }

  private isSecretArg(arg: string): boolean {
    if (arg.startsWith('sk-') || arg.startsWith('pat-') || arg.startsWith('ghp_')) {
      return true
    }
    const parts = arg.split('=')
    if (parts.length === 2) {
      return this.isSecretKey(parts[0])
    }
    return false
  }

  private redactIfLooksLikeSecret(value: string): string {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    if (trimmed.startsWith('sk-') || trimmed.startsWith('pat-') || trimmed.startsWith('ghp_')) {
      return '[REDACTED_SECRET]'
    }
    if (trimmed.length >= 16 && /^[a-zA-Z0-9_\-\.\=\+]+$/.test(trimmed)) {
      if (
        !trimmed.includes('/') &&
        !trimmed.includes('\\') &&
        !['true', 'false', 'localhost', '127.0.0.1'].includes(trimmed.toLowerCase())
      ) {
        return '[REDACTED_SECRET]'
      }
    }
    return value
  }

  private displayNameFromServerName(name: string): string {
    const slug = name.split('/').at(-1) || name
    return slug
      .split(/[-_.]+/)
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' ')
  }

  private async scanMcpConfigs(projectRepoPath?: string): Promise<ScannedMcpServer[]> {
    const configs: ScannedMcpServer[] = []

    // 1. Claude configs
    const claudePaths: { path: string; scope: 'project' | 'global' }[] = []
    if (projectRepoPath) {
      claudePaths.push({ path: path.join(projectRepoPath, '.mcp.json'), scope: 'project' })
    }
    claudePaths.push({ path: path.join(homedir(), '.claude.json'), scope: 'global' })

    for (const entry of claudePaths) {
      try {
        const content = await fs.readFile(entry.path, 'utf8')
        if (content.trim()) {
          const parsed = JSON.parse(content)
          if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
            for (const [name, server] of Object.entries(parsed.mcpServers)) {
              if (server && typeof server === 'object') {
                const s = server as any
                configs.push({
                  name,
                  agentId: 'claude-code',
                  scope: entry.scope,
                  transport: s.type === 'http' ? 'http' : 'stdio',
                  command: s.command,
                  args: s.args,
                  env: s.env,
                  url: s.url,
                  headers: s.headers,
                  filePath: entry.path
                })
              }
            }
          }
        }
      } catch (err: any) {
        // Skip ENOENT
      }
    }

    // 2. OpenCode configs
    const opencodePaths: { path: string; scope: 'project' | 'global' }[] = []
    if (projectRepoPath) {
      opencodePaths.push({ path: path.join(projectRepoPath, 'opencode.json'), scope: 'project' })
    }
    opencodePaths.push({ path: path.join(homedir(), '.config/opencode/opencode.json'), scope: 'global' })

    for (const entry of opencodePaths) {
      try {
        const content = await fs.readFile(entry.path, 'utf8')
        if (content.trim()) {
          const parsed = JSON.parse(content)
          if (parsed.mcp && typeof parsed.mcp === 'object') {
            for (const [name, server] of Object.entries(parsed.mcp)) {
              if (server && typeof server === 'object') {
                const s = server as any
                const isHttp = s.type === 'remote'
                let command: string | undefined
                let args: string[] | undefined
                if (!isHttp && Array.isArray(s.command) && s.command.length > 0) {
                  command = s.command[0]
                  args = s.command.slice(1)
                }
                configs.push({
                  name,
                  agentId: 'opencode',
                  scope: entry.scope,
                  transport: isHttp ? 'http' : 'stdio',
                  command,
                  args,
                  env: s.environment,
                  url: s.url,
                  headers: s.headers,
                  filePath: entry.path
                })
              }
            }
          }
        }
      } catch (err: any) {
        // Skip ENOENT
      }
    }

    // 3. Codex configs (TOML)
    const codexPaths: { path: string; scope: 'project' | 'global' }[] = []
    if (projectRepoPath) {
      codexPaths.push({ path: path.join(projectRepoPath, '.codex/config.toml'), scope: 'project' })
    }
    codexPaths.push({ path: path.join(homedir(), '.codex/config.toml'), scope: 'global' })

    for (const entry of codexPaths) {
      try {
        const content = await fs.readFile(entry.path, 'utf8')
        if (content.trim()) {
          const servers = this.parseCodexToml(content)
          for (const [name, server] of Object.entries(servers)) {
            if (server && typeof server === 'object') {
              const s = server as any
              configs.push({
                name,
                agentId: 'codex',
                scope: entry.scope,
                transport: s.url ? 'http' : 'stdio',
                command: s.command,
                args: s.args,
                url: s.url,
                filePath: entry.path
              })
            }
          }
        }
      } catch (err: any) {
        // Skip ENOENT
      }
    }

    return configs
  }

  private parseCodexToml(content: string): Record<string, any> {
    const mcpServers: Record<string, any> = {}
    const sectionPattern = /\[mcp_servers\.([^\]]+)\]([\s\S]*?)(?=\n\s*\[|$)/g
    let match
    while ((match = sectionPattern.exec(content)) !== null) {
      const serverName = match[1].trim()
      const body = match[2]
      const serverConfig: Record<string, any> = {}
      const kvPattern = /^\s*([a-zA-Z0-9_-]+)\s*=\s*(.+)$/gm
      let kvMatch
      while ((kvMatch = kvPattern.exec(body)) !== null) {
        const key = kvMatch[1].trim()
        const rawVal = kvMatch[2].trim()
        if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
          serverConfig[key] = JSON.parse(rawVal)
        } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
          try {
            serverConfig[key] = JSON.parse(rawVal)
          } catch {
            serverConfig[key] = rawVal
              .slice(1, -1)
              .split(',')
              .map(s => s.trim().replace(/^"|"$/g, ''))
              .filter(Boolean)
          }
        } else if (rawVal === 'true' || rawVal === 'false') {
          serverConfig[key] = rawVal === 'true'
        } else {
          serverConfig[key] = rawVal
        }
      }
      mcpServers[serverName] = serverConfig
    }
    return mcpServers
  }
}

interface ScannedMcpServer {
  name: string
  agentId: 'claude-code' | 'codex' | 'opencode'
  scope: 'project' | 'global'
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  filePath: string
}
