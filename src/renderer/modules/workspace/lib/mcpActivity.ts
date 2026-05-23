import type { AgentActivity } from '../../../../shared/types'

export type McpToolActivity =
  | Extract<AgentActivity, { kind: 'tool-call' }>
  | Extract<AgentActivity, { kind: 'tool-result' }>

export interface McpToolNameParts {
  server?: string
  tool: string
}

export function isMcpToolActivity(activity: AgentActivity): boolean {
  return (
    (activity.kind === 'tool-call' || activity.kind === 'tool-result') &&
    isMcpToolName(activity.name)
  )
}

export function isMcpToolName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.startsWith('mcp__') || lower.startsWith('mcp:')
}

export function parseMcpToolName(name: string): McpToolNameParts {
  const doubleUnderscore = /^mcp__(.+?)__(.+)$/i.exec(name)
  if (doubleUnderscore) {
    return {
      server: humanizeIdentifier(lastNamespaceSegment(doubleUnderscore[1] ?? '')),
      tool: humanizeIdentifier(doubleUnderscore[2] ?? name),
    }
  }

  const colonWithServer = /^mcp:([^:.]+)[.:](.+)$/i.exec(name)
  if (colonWithServer) {
    return {
      server: humanizeIdentifier(colonWithServer[1] ?? ''),
      tool: humanizeIdentifier(colonWithServer[2] ?? name),
    }
  }

  const colon = /^mcp:(.+)$/i.exec(name)
  if (colon) {
    return {
      tool: humanizeIdentifier(colon[1] ?? name),
    }
  }

  return { tool: name }
}

function lastNamespaceSegment(value: string): string {
  const segments = value.split(/_+/).filter(Boolean)
  return segments.at(-1) ?? value
}

function humanizeIdentifier(value: string): string {
  return value.replace(/[_-]+/g, ' ').trim() || value
}
