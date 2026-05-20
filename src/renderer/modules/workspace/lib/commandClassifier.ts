import type { RanCommandItem } from '../components/artifacts/RanCommandsPill'

export type CommandType = 'shell' | 'package' | 'git' | 'file-ops' | 'other'

export interface CommandMeta {
  type: CommandType
  showOutputByDefault: boolean
  icon: 'terminal' | 'package' | 'git' | 'file' | 'tool' | 'mcp'
  label: string
}

export interface PrettyToolName {
  /** Short namespace badge — e.g. the MCP server an integration belongs to. */
  namespace?: string
  /** Human-readable action name. */
  name: string
}

export function classifyCommand(item: RanCommandItem): CommandMeta {
  if (item.kind === 'command') {
    return classifyShellCommand(item.command)
  }

  if (item.kind === 'tool-call') {
    return classifyToolCall(item.name)
  }

  // tool-result inherits the type of its corresponding tool-call
  return classifyToolCall(item.name)
}

export function classifyShellCommand(command: string): CommandMeta {
  const trimmed = command.trim()
  const executable = trimmed.split(/\s+/)[0].split('/').pop() || ''

  // Package managers
  if (/^(npm|yarn|pnpm|pip|pip3|poetry|gem|brew|apt|yum|pacman)/.test(executable)) {
    return {
      type: 'package',
      showOutputByDefault: true,
      icon: 'package',
      label: 'npm',
    }
  }

  // Version control
  if (executable === 'git') {
    return {
      type: 'git',
      showOutputByDefault: false,
      icon: 'git',
      label: 'git',
    }
  }

  // File operations (we treat these as noise)
  if (/^(ls|cd|pwd|cat|mv|cp|rm|mkdir|touch|find|grep|head|tail)/.test(executable)) {
    return {
      type: 'file-ops',
      showOutputByDefault: false,
      icon: 'file',
      label: '$',
    }
  }

  // Default: shell command (high signal)
  return {
    type: 'shell',
    showOutputByDefault: true,
    icon: 'terminal',
    label: '$',
  }
}

const SHELL_TOOL_NAMES = ['bash', 'shell', 'sh', 'zsh', 'terminal']

export function classifyToolCall(toolName: string): CommandMeta {
  const lower = toolName.toLowerCase()

  // MCP integrations (mcp__<server>__<tool>) — collapsed by default since
  // their payloads are usually large JSON blobs.
  if (lower.startsWith('mcp__')) {
    return {
      type: 'other',
      showOutputByDefault: false,
      icon: 'mcp',
      label: 'mcp',
    }
  }

  // Shell-style execution tools. These keep the terminal icon/label for
  // display, but stay in the `other` bucket so tool-based executions group
  // with the rest of the tools rather than the `command`-kind shell group.
  if (SHELL_TOOL_NAMES.includes(lower)) {
    return {
      type: 'other',
      showOutputByDefault: true,
      icon: 'terminal',
      label: 'shell',
    }
  }

  // File-related tools
  if (/^(read|write|edit|copy|move|delete|mkdir|glob|grep|ls)/.test(lower)) {
    return {
      type: 'file-ops',
      showOutputByDefault: false,
      icon: 'file',
      label: 'file',
    }
  }

  // Default: treat other tools as shell-like (show output)
  return {
    type: 'other',
    showOutputByDefault: true,
    icon: 'tool',
    label: 'tool',
  }
}

/**
 * Turn a raw tool identifier into display-friendly parts.
 * `mcp__claude_ai_Linear__list_teams` → { namespace: 'Linear', name: 'list teams' }
 * Plain tool names pass through unchanged.
 */
export function prettifyToolName(rawName: string): PrettyToolName {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(rawName)
  if (mcp) {
    const serverSegments = mcp[1].split(/_+/).filter(Boolean)
    const namespace = serverSegments[serverSegments.length - 1] ?? mcp[1]
    return {
      namespace: titleCase(namespace),
      name: humanizeIdentifier(mcp[2]),
    }
  }
  return { name: rawName }
}

function humanizeIdentifier(value: string): string {
  return value.replace(/_+/g, ' ').trim() || value
}

function titleCase(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function getCommandTypeGroup(type: CommandType): string {
  const groups: Record<CommandType, string> = {
    shell: 'Shell Commands',
    package: 'Package Management',
    git: 'Version Control',
    'file-ops': 'File Operations',
    other: 'Tools',
  }
  return groups[type]
}
