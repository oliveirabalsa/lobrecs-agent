import type { AgentActivity } from '../../../../shared/types'

/**
 * Renderer-side reclassification of file-editing tool calls.
 *
 * Every agent (Claude Code, Codex, Antigravity, OpenCode) surfaces a file
 * edit as a generic `tool-call` activity — `Edit`, `Write`, `apply_patch`, …
 * The stream aggregator treats *all* tool calls as "command-like" and folds
 * them into a "Ran N commands" pill, so edits never reach `EditedFilesCard`.
 *
 * This module detects those tool calls and rewrites them into `file-change`
 * activities, carrying the per-file `additions` / `deletions` parsed from the
 * tool input. The matching low-signal `tool-result` ("File updated") is
 * dropped so the timeline shows the edit card instead of a command echo.
 */

type FileChange = Extract<AgentActivity, { kind: 'file-change' }>
type ToolCall = Extract<AgentActivity, { kind: 'tool-call' }>

/**
 * Tool names — lowercased — that mean "the agent wrote to a file".
 * Spans the four supported adapters plus common aliases.
 */
const EDIT_TOOL_NAMES = new Set<string>([
  // Claude Code
  'edit',
  'write',
  'multiedit',
  'notebookedit',
  // Codex
  'apply_patch',
  'applypatch',
  // OpenCode
  'patch',
  // Antigravity / generic
  'str_replace',
  'str_replace_editor',
  'create_file',
  'write_file',
  'write_to_file',
  'edit_file',
  'replace_file_content',
])

/** File-path field names used across the different adapters' tool inputs. */
const PATH_KEYS = [
  'file_path',
  'filePath',
  'path',
  'notebook_path',
  'target_file',
  'TargetFile',
  'absolute_path',
  'AbsolutePath',
  'FilePath',
]

/** "Before" content field names (the text being replaced). */
const OLD_KEYS = ['old_string', 'oldString', 'old_str', 'old_content', 'oldText']

/** "After" content field names (the replacement / new file body). */
const NEW_KEYS = [
  'new_string',
  'newString',
  'new_str',
  'new_content',
  'newText',
  'content',
  'CodeContent',
  'new_source',
  'code_edit',
]

export function isEditToolName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return false
  if (EDIT_TOOL_NAMES.has(normalized)) return true

  const parts = normalized.split(/[.:/]/).filter(Boolean)
  const tail = parts.at(-1)
  return tail ? EDIT_TOOL_NAMES.has(tail) : false
}

/**
 * Count the added / removed lines an edit represents.
 *
 * The agents only ever hand us the *changed region* (an `Edit`'s `old_string`
 * / `new_string`, or a full-file `Write` body), never the surrounding file.
 * That region usually carries a few unchanged "anchor" lines so the match is
 * unique — billing those as both an addition and a deletion would inflate the
 * counter. We trim the common leading/trailing lines first, so only the lines
 * that genuinely differ are counted (the same numbers Codex shows).
 */
export function countEditedLines(
  before: string,
  after: string,
): { additions: number; deletions: number } {
  const beforeLines = toLines(before)
  const afterLines = toLines(after)

  // Skip identical leading lines shared by both sides.
  let start = 0
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1
  }

  // Skip identical trailing lines, without crossing the leading cursor.
  let endBefore = beforeLines.length
  let endAfter = afterLines.length
  while (
    endBefore > start &&
    endAfter > start &&
    beforeLines[endBefore - 1] === afterLines[endAfter - 1]
  ) {
    endBefore -= 1
    endAfter -= 1
  }

  return { additions: endAfter - start, deletions: endBefore - start }
}

/**
 * Reclassify an editing `tool-call` into one or more `file-change` activities.
 * Returns `null` when the call is not a recognizable file edit (left as-is).
 */
export function fileChangesFromEditToolCall(activity: ToolCall): FileChange[] | null {
  if (activity.status === 'error') return null
  if (!isEditToolName(activity.name)) return null

  const changes = fileChangesFromInput(activity.input)
  return changes.length > 0 ? changes : null
}

/**
 * Pure transform over the activity stream: editing tool calls become
 * `file-change` activities, their success `tool-result` echoes are removed.
 * The optional `times` array is kept index-aligned with the output.
 */
export function transformFileEditActivities(
  activities: AgentActivity[],
  times?: number[],
): { activities: AgentActivity[]; times?: number[] } {
  const outActivities: AgentActivity[] = []
  const outTimes: number[] = []

  const push = (activity: AgentActivity, at: number | undefined): void => {
    outActivities.push(activity)
    if (at !== undefined) outTimes.push(at)
  }

  activities.forEach((activity, index) => {
    const at = times?.[index]

    if (activity.kind === 'tool-call') {
      const changes = fileChangesFromEditToolCall(activity)
      if (changes) {
        changes.forEach((change) => push(change, at))
        return
      }
    }

    // A successful edit's result is just a "File updated" confirmation —
    // drop it so the edit card stands alone. Failures stay visible.
    if (
      activity.kind === 'tool-result' &&
      activity.status !== 'error' &&
      isEditToolName(activity.name)
    ) {
      return
    }

    push(activity, at)
  })

  return {
    activities: outActivities,
    times: times ? outTimes : undefined,
  }
}

function fileChangesFromInput(input: unknown): FileChange[] {
  // Codex `apply_patch` hands the whole patch text as the input.
  if (typeof input === 'string') {
    const structured = parseStructuredInput(input)
    return structured ? fileChangesFromInput(structured) : fileChangesFromPatchText(input)
  }

  if (!isRecord(input)) return []

  const patch = pickString(input, ['patch', 'diff', 'content'])
  if (patch && looksLikePatchText(patch)) {
    return fileChangesFromPatchText(patch)
  }

  const filePath = pickString(input, PATH_KEYS)
  if (!filePath) return []

  // MultiEdit — sum every edit in the batch into one file-change.
  if (Array.isArray(input.edits)) {
    let additions = 0
    let deletions = 0
    for (const edit of input.edits) {
      if (!isRecord(edit)) continue
      const counts = countEditedLines(
        pickString(edit, OLD_KEYS) ?? '',
        pickString(edit, NEW_KEYS) ?? '',
      )
      additions += counts.additions
      deletions += counts.deletions
    }
    return [fileChange(filePath, 'modified', additions, deletions)]
  }

  const before = pickString(input, OLD_KEYS) ?? ''
  const after = pickString(input, NEW_KEYS) ?? ''
  if (!before && !after) return []

  const { additions, deletions } = countEditedLines(before, after)
  const changeType = !before && after ? 'added' : 'modified'
  return [fileChange(filePath, changeType, additions, deletions)]
}

/**
 * Parse a Codex `*** Begin Patch` block (or a unified diff) into per-file
 * `file-change` activities, tallying `+` / `-` body lines.
 */
function fileChangesFromPatchText(patch: string): FileChange[] {
  const tallies = new Map<string, { type: FileChange['changeType']; add: number; del: number }>()
  let current: string | null = null

  const ensure = (path: string, type: FileChange['changeType']) => {
    const existing = tallies.get(path)
    if (existing) return existing
    const fresh = { type, add: 0, del: 0 }
    tallies.set(path, fresh)
    return fresh
  }

  for (const line of patch.split('\n')) {
    const codexHeader = line.match(/^\*\*\*\s+(Add|Update|Delete)\s+File:\s*(.+)$/)
    if (codexHeader) {
      const [, verb, path] = codexHeader
      const type =
        verb === 'Add' ? 'added' : verb === 'Delete' ? 'deleted' : 'modified'
      current = path.trim()
      ensure(current, type).type = type
      continue
    }

    const unifiedHeader = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/)
    if (unifiedHeader) {
      const path = unifiedHeader[1].trim()
      current = path === '/dev/null' ? null : path
      if (current) ensure(current, 'modified')
      continue
    }

    if (!current) continue
    if (line.startsWith('+') && !line.startsWith('+++')) ensure(current, 'modified').add += 1
    else if (line.startsWith('-') && !line.startsWith('---')) ensure(current, 'modified').del += 1
  }

  return [...tallies].map(([filePath, tally]) =>
    fileChange(filePath, tally.type, tally.add, tally.del),
  )
}

function fileChange(
  filePath: string,
  changeType: FileChange['changeType'],
  additions: number,
  deletions: number,
): FileChange {
  return { kind: 'file-change', filePath, changeType, additions, deletions, status: 'applied' }
}

/** Split text into lines, ignoring a trailing newline. `''` → `[]`. */
function toLines(text: string): string[] {
  if (!text) return []
  return text.replace(/\n+$/, '').split('\n')
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function parseStructuredInput(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function looksLikePatchText(value: string): boolean {
  return (
    value.includes('*** Begin Patch') ||
    /^\s*(?:diff --git|\+\+\+ |\*\*\* (?:Add|Update|Delete) File:)/m.test(value)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
