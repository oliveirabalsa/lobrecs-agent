import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  ExtensionArtifact,
  ExtensionInstallAction,
  ExtensionInstallScope,
  ExtensionInlineSkillArtifact,
  ExtensionMcpServerArtifact,
  ExtensionPluginArtifact,
  ExtensionSkillArtifact,
  ExtensionSkillsCliArtifact,
  ExtensionTargetAgent,
} from '../../../../shared/types'
import {
  isRecord,
  readJsonObject,
  readTextFile,
  writeJsonObject,
  writeTextFile,
} from './configFiles'

const execFileAsync = promisify(execFile)
const SKILLS_CLI_TIMEOUT_MS = 120_000
const SKILLS_CLI_PATH_MARKER = '__LOBRECS_AGENT_SKILLS_PATH__'

interface InstallArtifactInput {
  artifact: ExtensionArtifact
  agentId: ExtensionTargetAgent
  scope: ExtensionInstallScope
  projectPath?: string
}

export async function installArtifactForAgent(
  input: InstallArtifactInput,
): Promise<ExtensionInstallAction> {
  if (input.artifact.kind === 'mcp-server') {
    return installMcpServer(input.artifact, input)
  }

  if (input.artifact.kind === 'skill') {
    return installSkill(input.artifact, input)
  }

  return installPlugin(input.artifact, input)
}

async function installMcpServer(
  artifact: ExtensionMcpServerArtifact,
  input: InstallArtifactInput,
): Promise<ExtensionInstallAction> {
  const resolvedArtifact = resolveMcpArtifact(artifact, input)
  if (input.agentId === 'codex') return installCodexMcp(resolvedArtifact, input)
  if (input.agentId === 'claude-code') return installClaudeMcp(resolvedArtifact, input)
  return installOpenCodeMcp(resolvedArtifact, input)
}

async function installSkill(
  artifact: ExtensionSkillArtifact,
  input: InstallArtifactInput,
): Promise<ExtensionInstallAction> {
  if (isSkillsCliArtifact(artifact)) {
    return installSkillsCliSkill(artifact, input)
  }

  if (input.agentId === 'codex') return installCodexSkill(artifact, input)
  if (input.agentId === 'opencode') return installOpenCodeInstruction(artifact, input)

  return {
    agentId: input.agentId,
    artifactKind: artifact.kind,
    status: 'skipped',
    message: 'Claude Code skills are distributed through Claude plugins; no direct skill file was written.',
  }
}

async function installSkillsCliSkill(
  artifact: ExtensionSkillsCliArtifact,
  input: InstallArtifactInput,
): Promise<ExtensionInstallAction> {
  const cwd = input.scope === 'project' ? requireProjectPath(input) : os.homedir()
  const args = skillsCliArgs(artifact, input)
  const options = {
    cwd,
    timeout: SKILLS_CLI_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      DISABLE_TELEMETRY: process.env.DISABLE_TELEMETRY ?? '1',
    },
  }

  try {
    await execSkillsCli(args, options)
  } catch (error) {
    throw new Error(
      `Failed to install ${artifact.skillName} with skills.sh: ${formatExecFailure(error)}`,
    )
  }

  return {
    agentId: input.agentId,
    artifactKind: artifact.kind,
    status: 'installed',
    message: `Installed ${artifact.skillName} for ${agentLabel(input.agentId)} with skills.sh.`,
    filePath: cwd,
    followUpCommand: formatCommand('npx', args),
  }
}

async function execSkillsCli(
  args: string[],
  options: {
    cwd: string
    timeout: number
    maxBuffer: number
    env: NodeJS.ProcessEnv
  },
): Promise<void> {
  try {
    await execFileAsync('npx', args, options)
    return
  } catch (error) {
    if (!isCommandNotFoundError(error)) throw error
  }

  const resolvedNpx = await resolveNpxFromLoginShell(options.env)
  if (!resolvedNpx) {
    throw new Error(
      'npx was not found from the app process or the login shell. Install Node.js/npm or make npx available in your shell PATH, then retry.',
    )
  }

  await execFileAsync(resolvedNpx.command, args, {
    ...options,
    env: {
      ...options.env,
      PATH: resolvedNpx.pathEnv,
    },
  })
}

async function resolveNpxFromLoginShell(
  env: NodeJS.ProcessEnv,
): Promise<{ command: string; pathEnv: string } | null> {
  for (const shell of loginShellCandidates()) {
    try {
      const result = await execFileAsync(
        shell,
        [
          '-lc',
          `command -v npx\nprintf '\\n${SKILLS_CLI_PATH_MARKER}\\n'\nprintf '%s' "$PATH"`,
        ],
        {
          timeout: 5_000,
          maxBuffer: 64 * 1024,
          env,
        },
      )
      const [commandOutput, pathOutput = ''] = bufferToString(execFileStdout(result)).split(
        `\n${SKILLS_CLI_PATH_MARKER}\n`,
      )
      const command = commandOutput.trim().split('\n').at(-1)?.trim()
      if (command && path.isAbsolute(command)) {
        return {
          command,
          pathEnv: mergePathEnv(path.dirname(command), pathOutput, env.PATH),
        }
      }
    } catch {
      // Try the next common shell before surfacing a user-facing npx error.
    }
  }

  return null
}

function loginShellCandidates(): string[] {
  if (process.platform === 'win32') return []
  return uniqueStrings([process.env.SHELL ?? '', '/bin/zsh', '/bin/bash', '/bin/sh'])
}

function mergePathEnv(...values: Array<string | undefined>): string {
  return uniqueStrings(values.flatMap(pathEntries)).join(path.delimiter)
}

function pathEntries(value: string | undefined): string[] {
  return value?.split(path.delimiter).filter((entry) => entry.length > 0) ?? []
}

function isCommandNotFoundError(error: unknown): boolean {
  return isExecError(error) && error.code === 'ENOENT'
}

async function installPlugin(
  artifact: ExtensionPluginArtifact,
  input: InstallArtifactInput,
): Promise<ExtensionInstallAction> {
  if (artifact.agentId !== input.agentId) {
    return {
      agentId: input.agentId,
      artifactKind: artifact.kind,
      status: 'skipped',
      message: `Plugin ${artifact.packageName} targets ${artifact.agentId}.`,
    }
  }

  if (input.agentId === 'opencode') return installOpenCodePlugin(artifact, input)

  return {
    agentId: input.agentId,
    artifactKind: artifact.kind,
    status: 'skipped',
    message: 'This plugin type requires the agent-native marketplace flow.',
  }
}

async function installCodexMcp(
  artifact: ExtensionMcpServerArtifact,
  input: InstallArtifactInput,
): Promise<ExtensionInstallAction> {
  const filePath = scopedPath(input, '.codex/config.toml', '.codex/config.toml')
  const current = await readTextFile(filePath)
  const next = upsertTomlSection(
    current,
    `mcp_servers.${artifact.serverName}`,
    codexMcpToml(artifact),
  )
  await writeTextFile(filePath, next)

  return {
    agentId: 'codex',
    artifactKind: artifact.kind,
    status: current === next ? 'updated' : 'installed',
    message: `Configured Codex MCP server ${artifact.serverName}.`,
    filePath,
  }
}

async function installClaudeMcp(
  artifact: ExtensionMcpServerArtifact,
  input: InstallArtifactInput,
): Promise<ExtensionInstallAction> {
  const filePath =
    input.scope === 'project'
      ? path.join(requireProjectPath(input), '.mcp.json')
      : path.join(os.homedir(), '.claude.json')
  const config = await readJsonObject(filePath)

  const mcpServers = ensurePlainObject(config.mcpServers)
  mcpServers[artifact.serverName] = claudeMcpEntry(artifact)
  config.mcpServers = mcpServers

  await writeJsonObject(filePath, config)

  return {
    agentId: 'claude-code',
    artifactKind: artifact.kind,
    status: 'installed',
    message: `Configured Claude Code MCP server ${artifact.serverName}.`,
    filePath,
    followUpCommand: input.scope === 'project' ? 'claude mcp reset-project-choices' : undefined,
  }
}

async function installOpenCodeMcp(
  artifact: ExtensionMcpServerArtifact,
  input: InstallArtifactInput,
): Promise<ExtensionInstallAction> {
  const filePath = openCodeConfigPath(input)
  const config = await readJsonObject(filePath)
  config.$schema =
    typeof config.$schema === 'string' ? config.$schema : 'https://opencode.ai/config.json'
  const mcp = ensurePlainObject(config.mcp)
  mcp[artifact.serverName] = openCodeMcpEntry(artifact)
  config.mcp = mcp
  await writeJsonObject(filePath, config)

  return {
    agentId: 'opencode',
    artifactKind: artifact.kind,
    status: 'installed',
    message: `Configured OpenCode MCP server ${artifact.serverName}.`,
    filePath,
  }
}

async function installCodexSkill(
  artifact: ExtensionInlineSkillArtifact,
  input: InstallArtifactInput,
): Promise<ExtensionInstallAction> {
  const base =
    input.scope === 'project'
      ? path.join(requireProjectPath(input), '.codex/skills')
      : path.join(os.homedir(), '.codex/skills')
  const filePath = path.join(base, artifact.skillName, 'SKILL.md')
  await writeTextFile(filePath, `${artifact.body.trim()}\n`)

  return {
    agentId: 'codex',
    artifactKind: artifact.kind,
    status: 'installed',
    message: `Installed Codex skill ${artifact.skillName}.`,
    filePath,
  }
}

async function installOpenCodeInstruction(
  artifact: ExtensionInlineSkillArtifact,
  input: InstallArtifactInput,
): Promise<ExtensionInstallAction> {
  const configPath = openCodeConfigPath(input)
  const instructionPath =
    input.scope === 'project'
      ? path.join(requireProjectPath(input), '.opencode/instructions', `${artifact.skillName}.md`)
      : path.join(os.homedir(), '.config/opencode/instructions', `${artifact.skillName}.md`)
  await writeTextFile(instructionPath, `${artifact.body.trim()}\n`)

  const config = await readJsonObject(configPath)
  config.$schema =
    typeof config.$schema === 'string' ? config.$schema : 'https://opencode.ai/config.json'
  const instructionRef =
    input.scope === 'project'
      ? path.relative(path.dirname(configPath), instructionPath)
      : instructionPath
  config.instructions = uniqueStrings([
    ...arrayOfStrings(config.instructions),
    normalizePathForConfig(instructionRef),
  ])
  await writeJsonObject(configPath, config)

  return {
    agentId: 'opencode',
    artifactKind: artifact.kind,
    status: 'installed',
    message: `Installed OpenCode instruction ${artifact.skillName}.`,
    filePath: instructionPath,
  }
}

async function installOpenCodePlugin(
  artifact: ExtensionPluginArtifact,
  input: InstallArtifactInput,
): Promise<ExtensionInstallAction> {
  const filePath = openCodeConfigPath(input)
  const config = await readJsonObject(filePath)
  config.$schema =
    typeof config.$schema === 'string' ? config.$schema : 'https://opencode.ai/config.json'
  config.plugin = uniqueStrings([...arrayOfStrings(config.plugin), artifact.packageName])
  await writeJsonObject(filePath, config)

  return {
    agentId: 'opencode',
    artifactKind: artifact.kind,
    status: 'installed',
    message: `Configured OpenCode plugin ${artifact.packageName}.`,
    filePath,
  }
}

function codexMcpToml(artifact: ExtensionMcpServerArtifact): string {
  const lines = [`[mcp_servers.${artifact.serverName}]`]
  if (artifact.transport === 'http') {
    lines.push(`url = ${tomlString(requireValue(artifact.url, 'url'))}`)
  } else {
    lines.push(`command = ${tomlString(requireValue(artifact.command, 'command'))}`)
    if (artifact.args?.length) lines.push(`args = ${tomlStringArray(artifact.args)}`)
  }
  return lines.join('\n')
}

function claudeMcpEntry(artifact: ExtensionMcpServerArtifact): Record<string, unknown> {
  if (artifact.transport === 'http') {
    return compactRecord({
      type: 'http',
      url: requireValue(artifact.url, 'url'),
      headers: artifact.headers,
    })
  }

  return compactRecord({
    command: requireValue(artifact.command, 'command'),
    args: artifact.args ?? [],
    env: artifact.env,
  })
}

function openCodeMcpEntry(artifact: ExtensionMcpServerArtifact): Record<string, unknown> {
  if (artifact.transport === 'http') {
    return compactRecord({
      type: 'remote',
      url: requireValue(artifact.url, 'url'),
      enabled: true,
      headers: artifact.headers,
    })
  }

  return compactRecord({
    type: 'local',
    command: [requireValue(artifact.command, 'command'), ...(artifact.args ?? [])],
    enabled: true,
    environment: artifact.env,
  })
}

function openCodeConfigPath(input: InstallArtifactInput): string {
  return input.scope === 'project'
    ? path.join(requireProjectPath(input), 'opencode.json')
    : path.join(os.homedir(), '.config/opencode/opencode.json')
}

function skillsCliArgs(
  artifact: ExtensionSkillsCliArtifact,
  input: InstallArtifactInput,
): string[] {
  const args = ['-y', 'skills', 'add', artifact.packageName]
  if (artifact.cliSkillName) args.push('--skill', artifact.cliSkillName)
  if (input.scope === 'global') args.push('--global')
  args.push('--agent', input.agentId, '--copy', '--yes')
  return args
}

function isSkillsCliArtifact(
  artifact: ExtensionSkillArtifact,
): artifact is ExtensionSkillsCliArtifact {
  return 'packageName' in artifact
}

function agentLabel(agentId: ExtensionTargetAgent): string {
  if (agentId === 'claude-code') return 'Claude Code'
  if (agentId === 'codex') return 'Codex'
  return 'OpenCode'
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(quoteArg).join(' ')
}

function quoteArg(value: string): string {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value)
}

function formatExecFailure(error: unknown): string {
  if (!isExecError(error)) {
    return error instanceof Error ? error.message : 'unknown error'
  }

  const output = [error.stderr, error.stdout]
    .map(bufferToString)
    .filter((value) => value.trim().length > 0)
    .join('\n')
    .trim()
  return output ? output.slice(0, 1200) : error.message
}

function isExecError(
  error: unknown,
): error is Error & {
  code?: string | number
  stdout?: string | Buffer
  stderr?: string | Buffer
} {
  return error instanceof Error
}

function bufferToString(value: string | Buffer | undefined): string {
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  return typeof value === 'string' ? value : ''
}

function execFileStdout(value: unknown): string | Buffer | undefined {
  if (typeof value === 'string' || Buffer.isBuffer(value)) return value
  if (isRecord(value)) {
    const stdout = value.stdout
    if (typeof stdout === 'string' || Buffer.isBuffer(stdout)) return stdout
  }
  return undefined
}

function scopedPath(
  input: InstallArtifactInput,
  projectRelative: string,
  globalRelative: string,
): string {
  return input.scope === 'project'
    ? path.join(requireProjectPath(input), projectRelative)
    : path.join(os.homedir(), globalRelative)
}

function requireProjectPath(input: InstallArtifactInput): string {
  if (!input.projectPath?.trim()) {
    throw new Error('Project path is required for project-scoped extension installs.')
  }
  return input.projectPath
}

function upsertTomlSection(content: string, sectionName: string, sectionContent: string): string {
  const escaped = escapeRegExp(sectionName)
  const pattern = new RegExp(`\\n?\\[${escaped}\\][\\s\\S]*?(?=\\n\\[[^\\]]+\\]|$)`, 'g')
  const withoutSection = content.replace(pattern, '').trimEnd()
  return `${withoutSection}${withoutSection ? '\n\n' : ''}${sectionContent.trim()}\n`
}

function ensurePlainObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null),
  )
}

function requireValue(value: string | undefined, label: string): string {
  if (!value) throw new Error(`MCP artifact is missing ${label}.`)
  return value
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(', ')}]`
}

function normalizePathForConfig(value: string): string {
  return value.split(path.sep).join('/')
}

function resolveMcpArtifact(
  artifact: ExtensionMcpServerArtifact,
  input: InstallArtifactInput,
): ExtensionMcpServerArtifact {
  return {
    ...artifact,
    args: artifact.args?.map((arg) => resolveConfigTemplate(arg, input)),
    env: artifact.env ? resolveRecordTemplates(artifact.env, input) : undefined,
    headers: artifact.headers ? resolveRecordTemplates(artifact.headers, input) : undefined,
  }
}

function resolveRecordTemplates(
  values: Record<string, string>,
  input: InstallArtifactInput,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, resolveConfigTemplate(value, input)]),
  )
}

function resolveConfigTemplate(value: string, input: InstallArtifactInput): string {
  if (!value.includes('${projectPath}')) return value
  return value.replaceAll('${projectPath}', requireProjectPath(input))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
