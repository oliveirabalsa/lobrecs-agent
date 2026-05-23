import type {
  ExtensionArtifactKind,
  MarketplaceExtension,
} from '../../../../../shared/types'

export type SlashMentionKind = ExtensionArtifactKind

export interface SlashMentionTrigger {
  start: number
  end: number
  query: string
}

export interface SlashMentionOption {
  id: string
  kind: SlashMentionKind
  label: string
  summary: string
  publisher?: string
}

export interface SlashMentionToken {
  raw: string
  kind: SlashMentionKind
  value: string
}

const KIND_PREFIX: Record<SlashMentionKind, string> = {
  skill: 'skill',
  plugin: 'plugin',
  'mcp-server': 'mcp',
}

const TOKEN_KIND: Record<string, SlashMentionKind> = {
  skill: 'skill',
  plugin: 'plugin',
  mcp: 'mcp-server',
}

export const SLASH_MENTION_CATEGORIES: SlashMentionKind[] = [
  'skill',
  'plugin',
  'mcp-server',
]

export function findActiveSlashMentionTrigger(
  value: string,
  cursorPosition: number,
): SlashMentionTrigger | null {
  const cursor = Math.max(0, Math.min(cursorPosition, value.length))
  const prefix = value.slice(0, cursor)
  const match = /(^|\s)\/([^\s/]*)$/.exec(prefix)
  if (!match) return null

  const query = match[2] ?? ''
  const start = prefix.length - query.length - 1
  return {
    start,
    end: cursor,
    query,
  }
}

export function extensionToSlashMentionOption(
  extension: MarketplaceExtension,
): SlashMentionOption | null {
  const kind = extensionKind(extension)
  if (!kind) return null

  return {
    id: extension.id,
    kind,
    label: extension.name,
    summary: extension.summary,
    publisher: extension.publisher,
  }
}

export function insertSlashMention(
  value: string,
  trigger: SlashMentionTrigger,
  option: SlashMentionOption,
): { value: string; cursorPosition: number } {
  const token = slashMentionToken(option)
  const needsTrailingSpace = value[trigger.end] !== ' '
  const insertion = `${token}${needsTrailingSpace ? ' ' : ''}`
  const nextValue = `${value.slice(0, trigger.start)}${insertion}${value.slice(trigger.end)}`

  return {
    value: nextValue,
    cursorPosition: trigger.start + insertion.length,
  }
}

export function slashMentionToken(option: SlashMentionOption): string {
  return `/${KIND_PREFIX[option.kind]}:${slugify(option.label)}`
}

export function extractSlashMentionTokens(value: string): SlashMentionToken[] {
  const tokens: SlashMentionToken[] = []
  const pattern = /\/(skill|plugin|mcp):([a-z0-9][a-z0-9._-]*)/gi

  for (const match of value.matchAll(pattern)) {
    const kind = TOKEN_KIND[match[1]?.toLowerCase() ?? '']
    const raw = match[0]
    const tokenValue = match[2]
    if (!kind || !raw || !tokenValue) continue
    tokens.push({ raw, kind, value: tokenValue })
  }

  return tokens
}

export function slashMentionKindLabel(kind: SlashMentionKind): string {
  if (kind === 'mcp-server') return 'MCP'
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

function extensionKind(extension: MarketplaceExtension): SlashMentionKind | null {
  if (extension.category === 'skill') return 'skill'
  if (extension.category === 'plugin') return 'plugin'
  if (extension.category === 'mcp-server') return 'mcp-server'

  for (const artifact of extension.artifacts) {
    if (artifact.kind === 'skill' || artifact.kind === 'plugin' || artifact.kind === 'mcp-server') {
      return artifact.kind
    }
  }

  return null
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'context'
}
