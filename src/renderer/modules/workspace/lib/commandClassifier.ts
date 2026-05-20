import type { RanCommandItem } from '../components/artifacts/RanCommandsPill'

export type CommandType = 'shell' | 'package' | 'git' | 'file-ops' | 'other'

export interface CommandMeta {
  type: CommandType
  showOutputByDefault: boolean
  icon: 'terminal' | 'package' | 'git' | 'file' | 'tool'
  label: string
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

function classifyShellCommand(command: string): CommandMeta {
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

function classifyToolCall(toolName: string): CommandMeta {
  const lower = toolName.toLowerCase()

  // File-related tools
  if (/^(read|write|edit|copy|move|delete|mkdir)/.test(lower)) {
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
    label: lower.slice(0, 4),
  }
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
