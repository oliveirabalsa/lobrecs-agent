import type { ThreadSearchResult } from '../../../shared/types'

export interface SearchPaletteCommand {
  id: string
  label: string
  description: string
  keywords?: readonly string[]
}

export type SearchPaletteItem =
  | { kind: 'command'; command: SearchPaletteCommand }
  | { kind: 'thread'; result: ThreadSearchResult }

export function buildSearchPaletteItems(input: {
  query: string
  commands: readonly SearchPaletteCommand[]
  threadResults: readonly ThreadSearchResult[]
}): SearchPaletteItem[] {
  const query = input.query.trim().toLowerCase()
  const commands = input.commands
    .filter((command) => commandMatchesQuery(command, query))
    .map((command): SearchPaletteItem => ({ kind: 'command', command }))
  const threads = input.threadResults.map((result): SearchPaletteItem => ({
    kind: 'thread',
    result,
  }))

  return [...commands, ...threads]
}

function commandMatchesQuery(command: SearchPaletteCommand, query: string): boolean {
  if (!query) return true
  const haystack = [command.label, command.description, ...(command.keywords ?? [])]
  return haystack.some((value) => value.toLowerCase().includes(query))
}
