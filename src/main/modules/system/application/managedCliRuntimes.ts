import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { buildProcessEnvironment } from '../../../process/environment'
import { commandExists, resolveCommand } from '../../../agents/command'
import type { MainIpcContext } from '../../shared/ipcContext'
import type {
  ManagedCliAction,
  ManagedCliActionId,
  ManagedCliActionResult,
  ManagedCliStatus,
  RunManagedCliActionInput,
  SupportedAgentId,
} from '../../../../shared/types'

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 120_000
const INFO_TIMEOUT_MS = 8_000
const OUTPUT_LIMIT = 120_000

type ManagedCliCommand = {
  executable: string
  args: string[]
  display: string
}

type ManagedCliDefinition = {
  agentId: SupportedAgentId
  name: string
  envVar: string
  fallbackCommand: string
  latestVersionPackage?: string
  docsUrl: string
  installSummary: string
  notes: string[]
  versionArgs: string[]
  actions: Partial<Record<ManagedCliActionId, ManagedCliActionDefinition>>
  commandFor(actionId: ManagedCliActionId, command: string): ManagedCliCommand | null
}

type ManagedCliActionDefinition = Omit<ManagedCliAction, 'available'> & {
  requiresLatestVersionCheck?: boolean
}

const CLI_DEFINITIONS: readonly ManagedCliDefinition[] = [
  {
    agentId: 'claude-code',
    name: 'Claude Code',
    envVar: 'CLAUDE_COMMAND',
    fallbackCommand: 'claude',
    latestVersionPackage: '@anthropic-ai/claude-code',
    docsUrl: 'https://code.claude.com/docs/en/setup',
    installSummary: 'Native installer is preferred; npm install is documented as an alternative.',
    notes: [
      'Native installs can auto-update; Homebrew, WinGet, and npm installs need explicit upgrades.',
      'Authentication is interactive. Use the terminal if a login prompt needs browser handoff.',
    ],
    versionArgs: ['--version'],
    actions: {
      install: {
        id: 'install',
        label: 'Install',
        description: 'Runs the official native installer for this operating system.',
        commandPreview: installScriptPreview('claude-code'),
        requiresInstalled: false,
      },
      upgrade: {
        id: 'upgrade',
        label: 'Update',
        description: 'Applies a Claude Code update through the CLI self-updater.',
        commandPreview: 'claude update',
        requiresInstalled: true,
      },
      'auth-status': {
        id: 'auth-status',
        label: 'Auth',
        description: 'Checks whether Claude Code is authenticated.',
        commandPreview: 'claude auth status --text',
        requiresInstalled: true,
      },
      doctor: {
        id: 'doctor',
        label: 'Doctor',
        description: 'Runs Claude Code environment diagnostics.',
        commandPreview: 'claude doctor',
        requiresInstalled: true,
      },
    },
    commandFor(actionId, command) {
      if (actionId === 'install') return installScriptCommand('claude-code')
      if (actionId === 'upgrade') return directCommand(command, ['update'])
      if (actionId === 'auth-status') return directCommand(command, ['auth', 'status', '--text'])
      if (actionId === 'doctor') return directCommand(command, ['doctor'])
      return null
    },
  },
  {
    agentId: 'codex',
    name: 'OpenAI Codex',
    envVar: 'CODEX_COMMAND',
    fallbackCommand: 'codex',
    latestVersionPackage: '@openai/codex',
    docsUrl: 'https://developers.openai.com/codex/cli',
    installSummary: 'Install with npm, then authenticate with the configured OpenAI account flow.',
    notes: [
      'The model catalog check uses the same command path as agent dispatch.',
      'The app only runs fixed Codex maintenance commands, never arbitrary Codex shell text.',
    ],
    versionArgs: ['--version'],
    actions: {
      install: {
        id: 'install',
        label: 'Install',
        description: 'Installs or refreshes the global Codex CLI npm package.',
        commandPreview: 'npm install -g @openai/codex',
        requiresInstalled: false,
      },
      upgrade: {
        id: 'upgrade',
        label: 'Upgrade',
        description: 'Runs the Codex CLI self-update path.',
        commandPreview: 'codex update',
        requiresInstalled: true,
      },
      doctor: {
        id: 'doctor',
        label: 'Doctor',
        description: 'Runs Codex diagnostics when supported by the installed CLI.',
        commandPreview: 'codex doctor',
        requiresInstalled: true,
      },
      models: {
        id: 'models',
        label: 'Models',
        description: 'Lists locally visible Codex models.',
        commandPreview: 'codex debug models',
        requiresInstalled: true,
      },
    },
    commandFor(actionId, command) {
      if (actionId === 'install') return directCommand('npm', ['install', '-g', '@openai/codex'])
      if (actionId === 'upgrade') return directCommand(command, ['update'])
      if (actionId === 'doctor') return directCommand(command, ['doctor'])
      if (actionId === 'models') return directCommand(command, ['debug', 'models'])
      return null
    },
  },
  {
    agentId: 'opencode',
    name: 'OpenCode',
    envVar: 'OPENCODE_COMMAND',
    fallbackCommand: 'opencode',
    latestVersionPackage: 'opencode-ai',
    docsUrl: 'https://dev.opencode.ai/docs/cli/',
    installSummary: 'Install with the official shell installer; OpenCode can also upgrade itself.',
    notes: [
      'Auth status lists provider names only; credentials stay in the CLI config location.',
      'Model refresh can call the provider catalog, so it may take a few seconds.',
    ],
    versionArgs: ['--version'],
    actions: {
      install: {
        id: 'install',
        label: 'Install',
        description: 'Runs the official OpenCode installer.',
        commandPreview: installScriptPreview('opencode'),
        requiresInstalled: false,
      },
      upgrade: {
        id: 'upgrade',
        label: 'Upgrade',
        description: 'Updates OpenCode to the latest version.',
        commandPreview: 'opencode upgrade',
        requiresInstalled: true,
      },
      'auth-status': {
        id: 'auth-status',
        label: 'Auth',
        description: 'Lists authenticated provider entries.',
        commandPreview: 'opencode auth list',
        requiresInstalled: true,
      },
      models: {
        id: 'models',
        label: 'Models',
        description: 'Refreshes and lists configured provider models.',
        commandPreview: 'opencode models --refresh',
        requiresInstalled: true,
      },
    },
    commandFor(actionId, command) {
      if (actionId === 'install') return installScriptCommand('opencode')
      if (actionId === 'upgrade') return directCommand(command, ['upgrade'])
      if (actionId === 'auth-status') return directCommand(command, ['auth', 'list'])
      if (actionId === 'models') return directCommand(command, ['models', '--refresh'])
      return null
    },
  },
  {
    agentId: 'antigravity',
    name: 'Antigravity CLI',
    envVar: 'ANTIGRAVITY_COMMAND',
    fallbackCommand: 'agy',
    docsUrl: 'https://antigravity.google/docs/cli-getting-started',
    installSummary: 'Install with the official Antigravity CLI installer for this platform.',
    notes: [
      'Antigravity auth is browser-based and interactive; open the CLI when a login is needed.',
      'Settings, permissions, plugins, and resume flows are slash-command driven inside agy.',
    ],
    versionArgs: ['--version'],
    actions: {
      install: {
        id: 'install',
        label: 'Install',
        description: 'Runs the official Antigravity CLI installer.',
        commandPreview: installScriptPreview('antigravity'),
        requiresInstalled: false,
      },
      doctor: {
        id: 'doctor',
        label: 'Help',
        description: 'Prints CLI help so users can confirm local command support.',
        commandPreview: 'agy --help',
        requiresInstalled: true,
      },
    },
    commandFor(actionId, command) {
      if (actionId === 'install') return installScriptCommand('antigravity')
      if (actionId === 'doctor') return directCommand(command, ['--help'])
      return null
    },
  },
  {
    agentId: 'cursor',
    name: 'Cursor CLI',
    envVar: 'CURSOR_AGENT_COMMAND',
    fallbackCommand: 'cursor-agent',
    docsUrl: 'https://docs.cursor.com/en/cli/installation',
    installSummary:
      'Install with the official Cursor CLI shell installer, then authenticate in Cursor CLI or environment.',
    notes: [
      'Cursor auth stays in Cursor CLI or CURSOR_API_KEY; Lobrecs does not persist keys.',
      'The managed actions use fixed cursor-agent commands and never accept arbitrary shell text.',
    ],
    versionArgs: ['--version'],
    actions: {
      install: {
        id: 'install',
        label: 'Install',
        description: 'Runs the official Cursor CLI installer.',
        commandPreview: installScriptPreview('cursor'),
        requiresInstalled: false,
      },
      upgrade: {
        id: 'upgrade',
        label: 'Update',
        description: 'Updates Cursor CLI through the documented self-update command.',
        commandPreview: 'cursor-agent update',
        requiresInstalled: true,
        requiresLatestVersionCheck: false,
      },
      doctor: {
        id: 'doctor',
        label: 'Help',
        description: 'Prints Cursor CLI help so users can confirm local command support.',
        commandPreview: 'cursor-agent --help',
        requiresInstalled: true,
      },
    },
    commandFor(actionId, command) {
      if (actionId === 'install') return installScriptCommand('cursor')
      if (actionId === 'upgrade') return directCommand(command, ['update'])
      if (actionId === 'doctor') return directCommand(command, ['--help'])
      return null
    },
  },
]

export async function listManagedCliRuntimes(
  context: MainIpcContext,
): Promise<ManagedCliStatus[]> {
  return Promise.all(CLI_DEFINITIONS.map((definition) => buildStatus(context, definition)))
}

export async function runManagedCliAction(
  context: MainIpcContext,
  input: RunManagedCliActionInput,
): Promise<ManagedCliActionResult> {
  const definition = definitionFor(input.agentId)
  const command = resolvedRuntimeCommand(context, definition)
  const action = definition.actions[input.actionId]
  const commandSpec = action ? definition.commandFor(input.actionId, command) : null

  if (!action || !commandSpec) {
    throw new Error(`Unsupported CLI action: ${input.actionId}`)
  }

  const installed = await commandExists(command).catch(() => false)

  if (input.actionId === 'install' && installed) {
    throw new Error(`${definition.name} is already installed.`)
  }

  if (action.requiresInstalled && !installed) {
    throw new Error(`${definition.name} is not installed or is not available on PATH.`)
  }

  if (input.actionId === 'upgrade' && action.requiresLatestVersionCheck !== false) {
    const updateState = await checkRuntimeUpdate(definition, command)
    if (updateState.error) throw new Error(updateState.error)
    if (!updateState.updateAvailable) {
      throw new Error(`${definition.name} is already on the latest version.`)
    }
  }

  return runManagedCommand(definition.agentId, input.actionId, commandSpec, {
    cwd: input.repoPath || homedir(),
    timeout: COMMAND_TIMEOUT_MS,
  })
}

function definitionFor(agentId: SupportedAgentId): ManagedCliDefinition {
  const definition = CLI_DEFINITIONS.find((item) => item.agentId === agentId)
  if (!definition) throw new Error(`Unsupported CLI runtime: ${agentId}`)
  return definition
}

async function buildStatus(
  context: MainIpcContext,
  definition: ManagedCliDefinition,
): Promise<ManagedCliStatus> {
  const command = resolvedRuntimeCommand(context, definition)
  const installed = await commandExists(command).catch(() => false)
  const [commandPath, versionResult, latestVersionResult] = await Promise.all([
    installed ? resolveCommandPath(command) : Promise.resolve(undefined),
    installed ? readVersion(definition, command) : Promise.resolve(undefined),
    readLatestVersion(definition),
  ])
  const updateAvailable = isRuntimeUpdateAvailable(
    versionResult?.version,
    latestVersionResult?.version,
  )

  return {
    agentId: definition.agentId,
    name: definition.name,
    command,
    commandPath,
    installed,
    version: versionResult?.version,
    versionError: versionResult?.error,
    latestVersion: latestVersionResult?.version,
    latestVersionError: latestVersionResult?.error,
    updateAvailable,
    docsUrl: definition.docsUrl,
    installSummary: definition.installSummary,
    notes: definition.notes,
    actions: Object.values(definition.actions).map((action) =>
      buildActionStatus(action, {
        installed,
        version: versionResult?.version,
        latestVersion: latestVersionResult?.version,
        updateAvailable,
        latestVersionError: latestVersionResult?.error,
      }),
    ),
  }
}

function resolvedRuntimeCommand(
  context: MainIpcContext,
  definition: ManagedCliDefinition,
): string {
  const override = context.settingsService.getGlobal().agents.runtimes[definition.agentId].command
  return resolveCommand(definition.envVar, definition.fallbackCommand, override)
}

async function readVersion(
  definition: ManagedCliDefinition,
  command: string,
): Promise<{ version?: string; error?: string }> {
  try {
    const result = await runManagedCommand(
      definition.agentId,
      'doctor',
      directCommand(command, definition.versionArgs),
      { timeout: INFO_TIMEOUT_MS },
    )
    const output = compactOutput(result.stdout || result.stderr)
    if (result.exitCode === 0 && output) return { version: output.split('\n')[0]?.trim() }

    return { error: compactOutput(result.stderr || result.stdout) || 'Version check failed.' }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Version check failed.' }
  }
}

async function readLatestVersion(
  definition: ManagedCliDefinition,
): Promise<{ version?: string; error?: string }> {
  if (!definition.latestVersionPackage) {
    return { error: 'Latest version check is not configured for this runtime.' }
  }

  try {
    const result = await execFileAsync('npm', ['view', definition.latestVersionPackage, 'version'], {
      env: buildProcessEnvironment(),
      timeout: INFO_TIMEOUT_MS,
      maxBuffer: 64_000,
    })
    const output = compactOutput(execStdout(result) || execStderr(result))
    const version = extractComparableVersion(output)

    if (version) return { version }

    return { error: 'Latest version check returned no version.' }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Latest version check failed.',
    }
  }
}

function buildActionStatus(
  action: ManagedCliActionDefinition,
  status: {
    installed: boolean
    version?: string
    latestVersion?: string
    latestVersionError?: string
    updateAvailable: boolean
  },
): ManagedCliAction {
  const unavailableReason = actionUnavailableReason(action, status)

  return {
    id: action.id,
    label: action.label,
    description: action.description,
    commandPreview: action.commandPreview,
    requiresInstalled: action.requiresInstalled,
    available: !unavailableReason,
    unavailableReason,
  }
}

function actionUnavailableReason(
  action: ManagedCliActionDefinition,
  status: {
    installed: boolean
    version?: string
    latestVersion?: string
    latestVersionError?: string
    updateAvailable: boolean
  },
): string | undefined {
  if (action.id === 'install') {
    return status.installed ? 'Already installed.' : undefined
  }

  if (action.requiresInstalled && !status.installed) {
    return 'Install this CLI before running this action.'
  }

  if (action.id !== 'upgrade') return undefined
  if (action.requiresLatestVersionCheck === false) return undefined

  if (!status.version) return 'Current version could not be checked.'
  if (!status.latestVersion) {
    return status.latestVersionError || 'Latest version could not be checked.'
  }
  if (!status.updateAvailable) return `Already on the latest version (${status.latestVersion}).`

  return undefined
}

async function checkRuntimeUpdate(
  definition: ManagedCliDefinition,
  command: string,
): Promise<{ updateAvailable: boolean; error?: string }> {
  const [versionResult, latestVersionResult] = await Promise.all([
    readVersion(definition, command),
    readLatestVersion(definition),
  ])

  if (versionResult.error || !versionResult.version) {
    return {
      updateAvailable: false,
      error: versionResult.error || 'Current version check failed.',
    }
  }

  if (latestVersionResult.error || !latestVersionResult.version) {
    return {
      updateAvailable: false,
      error: latestVersionResult.error || 'Latest version check failed.',
    }
  }

  return {
    updateAvailable: isRuntimeUpdateAvailable(versionResult.version, latestVersionResult.version),
  }
}

function isRuntimeUpdateAvailable(currentVersion?: string, latestVersion?: string): boolean {
  const current = extractComparableVersion(currentVersion)
  const latest = extractComparableVersion(latestVersion)
  if (!current || !latest) return false

  return compareSemver(latest, current) > 0
}

function extractComparableVersion(value?: string): string | undefined {
  return value?.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0]
}

function compareSemver(a: string, b: string): number {
  const [aCore, aPre] = splitPrerelease(a)
  const [bCore, bPre] = splitPrerelease(b)
  const aParts = aCore.split('.').map(toInt)
  const bParts = bCore.split('.').map(toInt)
  const length = Math.max(aParts.length, bParts.length)

  for (let i = 0; i < length; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }

  if (aPre && !bPre) return -1
  if (!aPre && bPre) return 1
  if (aPre && bPre) return aPre < bPre ? -1 : aPre > bPre ? 1 : 0
  return 0
}

function splitPrerelease(version: string): [string, string | undefined] {
  const idx = version.indexOf('-')
  if (idx === -1) return [version, undefined]
  return [version.slice(0, idx), version.slice(idx + 1)]
}

function toInt(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

async function resolveCommandPath(command: string): Promise<string | undefined> {
  if (command.includes('/') || command.includes('\\')) return command

  try {
    const lookupCommand = process.platform === 'win32' ? 'where' : 'which'
    const result = await execFileAsync(lookupCommand, [command], {
      env: buildProcessEnvironment(),
      timeout: INFO_TIMEOUT_MS,
      maxBuffer: 64_000,
    })

    return compactOutput(execStdout(result)).split('\n')[0]?.trim() || undefined
  } catch {
    return undefined
  }
}

async function runManagedCommand(
  agentId: SupportedAgentId,
  actionId: ManagedCliActionId,
  command: ManagedCliCommand,
  options: { cwd?: string; timeout: number },
): Promise<ManagedCliActionResult> {
  const startedAt = Date.now()

  try {
    const result = await execFileAsync(command.executable, command.args, {
      cwd: options.cwd,
      env: buildProcessEnvironment(),
      timeout: options.timeout,
      maxBuffer: OUTPUT_LIMIT,
    })

      return {
      agentId,
      actionId,
      command: command.display,
      exitCode: 0,
      stdout: compactOutput(execStdout(result)),
      stderr: compactOutput(execStderr(result)),
      startedAt,
      finishedAt: Date.now(),
    }
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      stdout?: string | Buffer
      stderr?: string | Buffer
      code?: number | string | null
      signal?: string | null
    }

    return {
      agentId,
      actionId,
      command: command.display,
      exitCode: typeof execError.code === 'number' ? execError.code : null,
      signal: execError.signal ?? null,
      stdout: compactOutput(execError.stdout),
      stderr: compactOutput(execError.stderr || execError.message),
      startedAt,
      finishedAt: Date.now(),
    }
  }
}

function directCommand(executable: string, args: string[]): ManagedCliCommand {
  return {
    executable,
    args,
    display: [executable, ...args].join(' '),
  }
}

function installScriptCommand(
  agentId: SupportedAgentId,
): ManagedCliCommand {
  if (process.platform === 'win32') {
    if (agentId === 'claude-code') {
      return directCommand('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'irm https://claude.ai/install.ps1 | iex',
      ])
    }
    if (agentId === 'antigravity') {
      return directCommand('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'irm https://antigravity.google/cli/install.ps1 | iex',
      ])
    }
  }

  if (agentId === 'claude-code') {
    return directCommand('/bin/bash', ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'])
  }
  if (agentId === 'opencode') {
    return directCommand('/bin/bash', ['-lc', 'curl -fsSL https://opencode.ai/install | bash'])
  }
  if (agentId === 'antigravity') {
    return directCommand('/bin/bash', [
      '-lc',
      'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    ])
  }
  if (agentId === 'cursor') {
    return directCommand('/bin/bash', ['-lc', 'curl https://cursor.com/install -fsS | bash'])
  }

  throw new Error(`No installer is configured for ${agentId}`)
}

function installScriptPreview(agentId: SupportedAgentId): string {
  if (agentId === 'claude-code') {
    return process.platform === 'win32'
      ? 'irm https://claude.ai/install.ps1 | iex'
      : 'curl -fsSL https://claude.ai/install.sh | bash'
  }
  if (agentId === 'opencode') return 'curl -fsSL https://opencode.ai/install | bash'
  if (agentId === 'antigravity') {
    return process.platform === 'win32'
      ? 'irm https://antigravity.google/cli/install.ps1 | iex'
      : 'curl -fsSL https://antigravity.google/cli/install.sh | bash'
  }
  if (agentId === 'cursor') return 'curl https://cursor.com/install -fsS | bash'
  return ''
}

function compactOutput(value: unknown): string {
  const text = Buffer.isBuffer(value) ? value.toString() : String(value ?? '')
  const normalized = text.replace(/\u001b\[[0-9;]*m/g, '').trim()
  if (normalized.length <= OUTPUT_LIMIT) return normalized

  return `${normalized.slice(0, OUTPUT_LIMIT)}\n[output truncated]`
}

function execStdout(result: unknown): unknown {
  if (isExecOutput(result)) return result.stdout
  return result
}

function execStderr(result: unknown): unknown {
  if (isExecOutput(result)) return result.stderr
  return ''
}

function isExecOutput(result: unknown): result is { stdout?: unknown; stderr?: unknown } {
  return typeof result === 'object' && result !== null && ('stdout' in result || 'stderr' in result)
}
