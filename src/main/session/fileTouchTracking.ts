import path from 'node:path'
import type { AgentActivity, DiffProposal } from '../../shared/types'

type FileChange = Extract<AgentActivity, { kind: 'file-change' }>
type ToolCall = Extract<AgentActivity, { kind: 'tool-call' }>

const EDIT_TOOL_NAMES = new Set([
  'edit',
  'write',
  'multiedit',
  'notebookedit',
  'apply_patch',
  'applypatch',
  'patch',
  'str_replace',
  'str_replace_editor',
  'create_file',
  'write_file',
  'write_to_file',
  'edit_file',
  'replace_file_content',
])

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

export function noteTouchedFilesFromActivity(
  touchedFiles: Set<string>,
  repoPath: string,
  activity: AgentActivity,
): void {
  for (const filePath of touchedFilePathsFromActivity(activity)) {
    touchedFiles.add(normalizeTouchedPath(repoPath, filePath))
  }
}

export function filterProposalsToTouchedFiles(
  proposals: readonly DiffProposal[],
  repoPath: string,
  touchedFiles: ReadonlySet<string>,
): DiffProposal[] {
  if (touchedFiles.size === 0) return []

  return proposals.filter((proposal) =>
    touchedFiles.has(normalizeTouchedPath(repoPath, proposal.filePath)),
  )
}

function touchedFilePathsFromActivity(activity: AgentActivity): string[] {
  if (activity.kind === 'file-change') return [activity.filePath]
  if (activity.kind !== 'tool-call') return []
  if (activity.status === 'error') return []
  if (!isEditToolName(activity.name)) return []

  return touchedFilePathsFromToolInput(activity)
}

function isEditToolName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return false
  if (EDIT_TOOL_NAMES.has(normalized)) return true

  const tail = normalized.split(/[.:/]/).filter(Boolean).at(-1)
  return tail ? EDIT_TOOL_NAMES.has(tail) : false
}

function touchedFilePathsFromToolInput(activity: ToolCall): string[] {
  const input = activity.input
  if (typeof input === 'string') {
    const structured = parseStructuredInput(input)
    if (structured) return touchedFilePathsFromRecord(structured)
    return touchedFilePathsFromPatchText(input)
  }

  if (!isRecord(input)) return []
  return touchedFilePathsFromRecord(input)
}

function touchedFilePathsFromRecord(input: Record<string, unknown>): string[] {
  const patch = pickString(input, ['patch', 'diff', 'content'])
  if (patch && looksLikePatchText(patch)) return touchedFilePathsFromPatchText(patch)

  const filePath = pickString(input, PATH_KEYS)
  return filePath ? [filePath] : []
}

function touchedFilePathsFromPatchText(patch: string): string[] {
  const paths = new Set<string>()

  for (const line of patch.split('\n')) {
    const codexHeader = line.match(/^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+)$/)
    if (codexHeader) {
      paths.add(codexHeader[1].trim())
      continue
    }

    const unifiedHeader = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/)
    if (unifiedHeader) {
      const filePath = unifiedHeader[1].trim()
      if (filePath !== '/dev/null') paths.add(filePath)
    }
  }

  return [...paths]
}

function normalizeTouchedPath(repoPath: string, filePath: string): string {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(repoPath, filePath)
  return path.relative(repoPath, absolutePath).split(path.sep).join('/')
}

function pickString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
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
