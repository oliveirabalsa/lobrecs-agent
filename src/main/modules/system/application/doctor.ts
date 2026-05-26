import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { MainIpcContext } from '../../shared/ipcContext'
import type { DoctorCheck, DoctorReport } from '../../../../shared/contracts/system'
import { listManagedCliRuntimes } from './managedCliRuntimes'
import { commandExists } from '../../../agents/command'
import { requireProject } from '../../projects/application/requireProject'
import { SUPPORTED_AGENT_IDS } from '../../../../shared/types'

const require = createRequire(import.meta.url)

export class DoctorService {
  constructor(private readonly context: MainIpcContext) {}

  async runDoctor(projectId?: string): Promise<DoctorReport> {
    const checks: DoctorCheck[] = []

    // 1. Agent runtimes
    for (const agentId of SUPPORTED_AGENT_IDS) {
      const adapter = this.context.adapters.get(agentId)
      let installed = false
      let details: string | undefined
      if (adapter) {
        try {
          installed = await adapter.isInstalled()
        } catch (err: any) {
          details = err.message
        }
      }
      checks.push({
        id: `agent:${agentId}`,
        name: `Agent Runtime: ${adapter?.name || agentId}`,
        status: installed ? 'passed' : 'failed',
        message: installed ? 'Available' : 'Not installed or unavailable',
        ...(details ? { details } : {})
      })
    }

    // 2. Managed CLIs
    try {
      const runtimes = await listManagedCliRuntimes(this.context)
      for (const runtime of runtimes) {
        checks.push({
          id: `cli:${runtime.agentId}`,
          name: `CLI Runtime: ${runtime.name}`,
          status: runtime.installed ? 'passed' : 'failed',
          message: runtime.installed
            ? `Installed (${runtime.version ?? 'unknown version'})`
            : 'Not installed',
          details: runtime.versionError || runtime.latestVersionError || undefined
        })
      }
    } catch (err: any) {
      checks.push({
        id: 'cli:error',
        name: 'CLI Runtimes Status',
        status: 'failed',
        message: 'Could not query CLI runtimes',
        details: err.message
      })
    }

    // 3. Repo writeability
    if (projectId) {
      let writeable = false
      let details: string | undefined
      try {
        const project = requireProject(projectId)
        const testFile = path.join(project.repoPath, `.doctor-write-test-${Date.now()}`)
        await fs.writeFile(testFile, 'test', 'utf8')
        await fs.unlink(testFile)
        writeable = true
      } catch (err: any) {
        details = err.message
      }
      checks.push({
        id: 'repo:writeable',
        name: 'Repository Writeability',
        status: writeable ? 'passed' : 'failed',
        message: writeable ? 'Repository is writeable' : 'Repository is read-only or not writeable',
        ...(details ? { details } : {})
      })
    } else {
      checks.push({
        id: 'repo:writeable',
        name: 'Repository Writeability',
        status: 'not-run',
        message: 'No project selected'
      })
    }

    // 4. rtk availability
    const rtkExists = await commandExists('rtk')
    checks.push({
      id: 'rtk:available',
      name: 'rtk CLI Availability',
      status: rtkExists ? 'passed' : 'warning',
      message: rtkExists ? 'rtk is available on PATH' : 'rtk command not found on PATH',
      details: rtkExists
        ? undefined
        : 'Run commands without rtk prefix may not run correctly under isolated environments.'
    })

    // 5. Native module sanity
    let nativeSanityStatus: 'passed' | 'failed' = 'passed'
    const nativeSanityErrors: string[] = []
    try {
      const Database = require('better-sqlite3')
      const db = new Database(':memory:')
      db.close()
    } catch (err: any) {
      nativeSanityStatus = 'failed'
      nativeSanityErrors.push(`better-sqlite3: ${err.message}`)
    }
    try {
      const pty = require('node-pty')
      if (typeof pty.spawn !== 'function') {
        nativeSanityStatus = 'failed'
        nativeSanityErrors.push('node-pty: spawn is not a function')
      }
    } catch (err: any) {
      nativeSanityStatus = 'failed'
      nativeSanityErrors.push(`node-pty: ${err.message}`)
    }
    checks.push({
      id: 'native:sanity',
      name: 'Native Module Sanity',
      status: nativeSanityStatus,
      message: nativeSanityStatus === 'passed' ? 'All native modules are sane' : 'Native module loading failed',
      details: nativeSanityErrors.length > 0 ? nativeSanityErrors.join('\n') : undefined
    })

    // 6. Verification recipes
    let verificationStatus: 'passed' | 'warning' | 'failed' = 'passed'
    const verificationIssues: string[] = []
    try {
      const settings = this.context.settingsService.getEffective(projectId).settings
      const recipes = settings.verification.recipes
      const requirePrefix = settings.verification.requireCommandPrefix || settings.execution.warnWhenCommandMissingPrefix
      const prefix = (settings.execution.commandPrefix || 'rtk').trim()

      for (const recipe of recipes) {
        const cmdTrim = recipe.command.trim()
        if (requirePrefix && prefix && !cmdTrim.startsWith(prefix)) {
          verificationStatus = 'warning'
          verificationIssues.push(`Recipe "${recipe.label}" command is missing prefix "${prefix}"`)
        }
        let binary = cmdTrim
        if (prefix && cmdTrim.startsWith(prefix)) {
          binary = cmdTrim.slice(prefix.length).trim()
        }
        const mainCmd = binary.split(/\s+/)[0]
        if (mainCmd) {
          const exists = await commandExists(mainCmd)
          if (!exists) {
            verificationStatus = 'warning'
            verificationIssues.push(`Recipe "${recipe.label}" executable "${mainCmd}" not found on PATH`)
          }
        }
      }
    } catch (err: any) {
      verificationStatus = 'failed'
      verificationIssues.push(`Error checking verification recipes: ${err.message}`)
    }
    checks.push({
      id: 'verification:recipes',
      name: 'Verification Recipes',
      status: verificationStatus,
      message: verificationStatus === 'passed' ? 'Verification recipes are valid' : 'Verification recipe issues found',
      details: verificationIssues.length > 0 ? verificationIssues.join('\n') : undefined
    })

    // 7. MCP config health
    let mcpStatus: 'passed' | 'warning' | 'failed' = 'passed'
    const mcpIssues: string[] = []

    const project = projectId ? requireProject(projectId) : null

    // Claude MCP config paths
    const claudePaths: string[] = []
    if (project) {
      claudePaths.push(path.join(project.repoPath, '.mcp.json'))
    }
    claudePaths.push(path.join(homedir(), '.claude.json'))

    for (const p of claudePaths) {
      try {
        const content = await fs.readFile(p, 'utf8')
        if (content.trim()) {
          const parsed = JSON.parse(content)
          if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
            for (const [name, server] of Object.entries(parsed.mcpServers)) {
              if (server && typeof server === 'object' && (server as any).command) {
                const cmd = (server as any).command
                const exists = await commandExists(cmd)
                if (!exists) {
                  mcpStatus = 'warning'
                  mcpIssues.push(`Claude MCP "${name}" command "${cmd}" not found on PATH in ${p}`)
                }
              }
            }
          }
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          mcpStatus = 'failed'
          mcpIssues.push(`Failed to parse Claude config at ${p}: ${err.message}`)
        }
      }
    }

    // OpenCode MCP config paths
    const opencodePaths: string[] = []
    if (project) {
      opencodePaths.push(path.join(project.repoPath, 'opencode.json'))
    }
    opencodePaths.push(path.join(homedir(), '.config/opencode/opencode.json'))

    for (const p of opencodePaths) {
      try {
        const content = await fs.readFile(p, 'utf8')
        if (content.trim()) {
          const parsed = JSON.parse(content)
          if (parsed.mcp && typeof parsed.mcp === 'object') {
            for (const [name, server] of Object.entries(parsed.mcp)) {
              if (server && typeof server === 'object' && (server as any).type === 'local') {
                const cmdArgs = (server as any).command
                if (Array.isArray(cmdArgs) && cmdArgs.length > 0) {
                  const cmd = cmdArgs[0]
                  const exists = await commandExists(cmd)
                  if (!exists) {
                    mcpStatus = 'warning'
                    mcpIssues.push(`OpenCode MCP "${name}" command "${cmd}" not found on PATH in ${p}`)
                  }
                }
              }
            }
          }
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          mcpStatus = 'failed'
          mcpIssues.push(`Failed to parse OpenCode config at ${p}: ${err.message}`)
        }
      }
    }

    // Codex MCP config paths (TOML)
    const codexPaths: string[] = []
    if (project) {
      codexPaths.push(path.join(project.repoPath, '.codex/config.toml'))
    }
    codexPaths.push(path.join(homedir(), '.codex/config.toml'))

    for (const p of codexPaths) {
      try {
        const content = await fs.readFile(p, 'utf8')
        if (content.trim()) {
          const servers = this.parseCodexToml(content)
          for (const [name, server] of Object.entries(servers)) {
            if (server && typeof server === 'object' && (server as any).command) {
              const cmd = (server as any).command
              const exists = await commandExists(cmd)
              if (!exists) {
                mcpStatus = 'warning'
                mcpIssues.push(`Codex MCP "${name}" command "${cmd}" not found on PATH in ${p}`)
              }
            }
          }
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          mcpStatus = 'failed'
          mcpIssues.push(`Failed to parse Codex config at ${p}: ${err.message}`)
        }
      }
    }

    checks.push({
      id: 'mcp:health',
      name: 'MCP Config Health',
      status: mcpStatus,
      message: mcpStatus === 'passed' ? 'MCP configuration is healthy' : 'MCP configuration issues found',
      details: mcpIssues.length > 0 ? mcpIssues.join('\n') : undefined
    })

    // Determine overallStatus
    let overallStatus: 'passed' | 'warning' | 'failed' = 'passed'
    if (checks.some((c) => c.status === 'failed')) {
      overallStatus = 'failed'
    } else if (checks.some((c) => c.status === 'warning')) {
      overallStatus = 'warning'
    }

    return {
      checkedAt: Date.now(),
      overallStatus,
      checks
    }
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
