import type { RanCommandItem } from '../components/artifacts/RanCommandsPill'

export function formatCommandDisplay(item: RanCommandItem): {
  title: string
  details?: string
} {
  if (item.kind === 'tool-call') {
    return formatToolCall(item)
  }
  if (item.kind === 'command') {
    return { title: item.command }
  }
  return { title: item.name }
}

function formatToolCall(item: RanCommandItem & { kind: 'tool-call' }): {
  title: string
  details?: string
} {
  const { name, input } = item
  const lower = name.toLowerCase()

  // File operations
  if (/^(read|write|edit|copy|move|delete|mkdir)/.test(lower) && typeof input === 'object' && input !== null) {
    const obj = input as Record<string, unknown>
    const filePath = obj.file_path as string | undefined
    return {
      title: name,
      details: filePath ? abbreviatePath(filePath) : undefined,
    }
  }

  // Shell/Bash
  if (lower === 'bash' && typeof input === 'object' && input !== null) {
    const obj = input as Record<string, unknown>
    const command = obj.command as string | undefined
    return {
      title: name,
      details: command ? command.split('\n')[0] : undefined,
    }
  }

  // Glob
  if (lower === 'glob' && typeof input === 'object' && input !== null) {
    const obj = input as Record<string, unknown>
    const pattern = obj.pattern as string | undefined
    return {
      title: name,
      details: pattern ? abbreviatePath(pattern) : undefined,
    }
  }

  // Grep
  if (lower === 'grep' && typeof input === 'object' && input !== null) {
    const obj = input as Record<string, unknown>
    const pattern = obj.pattern as string | undefined
    return {
      title: name,
      details: pattern ? `"${pattern}"` : undefined,
    }
  }

  // Fallback for string input
  if (typeof input === 'string') {
    return {
      title: name,
      details: input.slice(0, 50),
    }
  }

  return { title: name }
}

function abbreviatePath(fullPath: string): string {
  // Show relative path from current working directory
  const cwd = '/Users/leonardooliveirabalsalobre/Documents/projects/lobrecs-agent'
  if (fullPath.startsWith(cwd)) {
    return fullPath.slice(cwd.length + 1)
  }
  return fullPath
}
