import { describe, expect, it } from 'vitest'
import type { MarketplaceExtension } from '../../../../../shared/types'
import {
  extractSlashMentionTokens,
  extensionToSlashMentionOption,
  findActiveSlashMentionTrigger,
  insertSlashMention,
} from './slashMentions'

describe('slash mention helpers', () => {
  it('detects a slash trigger at the current cursor position', () => {
    expect(findActiveSlashMentionTrigger('Use /git', 'Use /git'.length)).toEqual({
      start: 4,
      end: 8,
      query: 'git',
    })
  })

  it('ignores slash text once the cursor has moved past whitespace', () => {
    expect(findActiveSlashMentionTrigger('Use /git now', 'Use /git now'.length)).toBeNull()
  })

  it('inserts a typed mention token and keeps the remaining prompt text', () => {
    const result = insertSlashMention(
      'Use /git for this',
      { start: 4, end: 8, query: 'git' },
      {
        id: 'github-mcp',
        kind: 'mcp-server',
        label: 'GitHub MCP',
        summary: 'GitHub tools',
      },
    )

    expect(result.value).toBe('Use /mcp:github-mcp for this')
    expect(result.cursorPosition).toBe('/mcp:github-mcp'.length + 4)
  })

  it('maps marketplace entries to mentionable skills, plugins, and MCP servers', () => {
    const extension = {
      id: 'clean-code',
      name: 'Clean Code',
      summary: 'Repo coding checklist',
      description: 'Repo coding checklist',
      publisher: 'Lobrecs',
      category: 'skill',
      source: 'curated',
      tags: [],
      artifacts: [],
      targetAgents: ['codex'],
    } satisfies MarketplaceExtension

    expect(extensionToSlashMentionOption(extension)).toMatchObject({
      id: 'clean-code',
      kind: 'skill',
      label: 'Clean Code',
    })
  })

  it('extracts selected mention tokens for the composer highlight row', () => {
    expect(extractSlashMentionTokens('/skill:clean-code use /mcp:github-mcp')).toEqual([
      { raw: '/skill:clean-code', kind: 'skill', value: 'clean-code' },
      { raw: '/mcp:github-mcp', kind: 'mcp-server', value: 'github-mcp' },
    ])
  })
})
