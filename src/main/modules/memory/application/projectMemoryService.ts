import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  PROJECT_MEMORY_VERSION,
  type CreateProjectKnowledgeInput,
  type ProjectKnowledgeEntry,
  type ProjectKnowledgeKind,
  type ProjectKnowledgeSource,
  type ProjectMemoryFile,
} from '../../../../shared/contracts/memory'
import type { FeedbackOutcome } from '../../../../shared/contracts/feedback'
import { projectsStore, sessionsStore } from '../../../store'

const MEMORY_DIR = '.lobrecs'
const MEMORY_FILE = 'memory.json'
const MAX_ENTRIES = 100
const MAX_PROMPT_ENTRIES = 12
const MAX_SUMMARY_CHARS = 240
const MAX_DETAILS_CHARS = 1_000

const knowledgeKinds = new Set<ProjectKnowledgeKind>([
  'architecture',
  'workflow',
  'preference',
  'failure',
  'general',
])
const knowledgeSources = new Set<ProjectKnowledgeSource>(['manual', 'user-feedback', 'system'])

export class ProjectMemoryService {
  async list(projectId: string): Promise<ProjectKnowledgeEntry[]> {
    const project = requireProject(projectId)
    return this.listForRepo(project.repoPath)
  }

  async save(input: CreateProjectKnowledgeInput): Promise<ProjectKnowledgeEntry> {
    const project = requireProject(input.projectId)
    return this.saveForRepo(project.repoPath, input)
  }

  async delete(projectId: string, entryId: string): Promise<void> {
    const project = requireProject(projectId)
    const snapshot = await this.readMemory(project.repoPath)
    const nextEntries = snapshot.entries.filter((entry) => entry.id !== entryId)
    if (nextEntries.length === snapshot.entries.length) return

    await this.writeMemory(project.repoPath, { ...snapshot, entries: nextEntries })
  }

  async learnFromFeedback(
    sessionId: string,
    outcome: FeedbackOutcome,
    note?: string,
  ): Promise<ProjectKnowledgeEntry | null> {
    if (outcome === 'failure') return null

    const summary = normalizeOptionalText(note, MAX_SUMMARY_CHARS)
    if (!summary) return null

    const session = sessionsStore.get(sessionId)
    if (!session) return null

    return this.save({
      projectId: session.projectId,
      kind: 'workflow',
      summary,
      details: `Learned after user marked session ${sessionId} as ${outcome}.`,
      source: 'user-feedback',
      sourceSessionId: sessionId,
    })
  }

  async buildPromptContext(params: {
    repoPath: string
    baseContext?: string | null
  }): Promise<string | null | undefined> {
    const knowledgeBlock = formatKnowledgeBlock(await this.listForRepo(params.repoPath))
    const baseContext = params.baseContext?.trim()

    if (!knowledgeBlock) return params.baseContext
    if (!baseContext) return knowledgeBlock

    return `${baseContext}\n\n${knowledgeBlock}`
  }

  async listForRepo(repoPath: string): Promise<ProjectKnowledgeEntry[]> {
    const snapshot = await this.readMemory(repoPath)
    return [...snapshot.entries].sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async saveForRepo(
    repoPath: string,
    input: Omit<CreateProjectKnowledgeInput, 'projectId'>,
  ): Promise<ProjectKnowledgeEntry> {
    const snapshot = await this.readMemory(repoPath)
    const now = Date.now()
    const kind = normalizeKind(input.kind)
    const source = normalizeSource(input.source)
    const summary = requireNormalizedText(input.summary, 'Knowledge summary', MAX_SUMMARY_CHARS)
    const details = normalizeOptionalText(input.details, MAX_DETAILS_CHARS)
    const duplicateKey = entryKey(kind, summary)
    const existingIndex = snapshot.entries.findIndex(
      (entry) => entryKey(entry.kind, entry.summary) === duplicateKey,
    )

    let entry: ProjectKnowledgeEntry
    let entries: ProjectKnowledgeEntry[]
    if (existingIndex >= 0) {
      const existing = snapshot.entries[existingIndex]
      entry = {
        ...existing,
        details: details ?? existing.details,
        source,
        sourceSessionId: input.sourceSessionId ?? existing.sourceSessionId,
        updatedAt: now,
      }
      entries = [
        entry,
        ...snapshot.entries.filter((_, index) => index !== existingIndex),
      ].slice(0, MAX_ENTRIES)
    } else {
      entry = {
        id: randomUUID(),
        kind,
        summary,
        ...(details ? { details } : {}),
        source,
        ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}),
        createdAt: now,
        updatedAt: now,
      }
      entries = [entry, ...snapshot.entries].slice(0, MAX_ENTRIES)
    }

    await this.writeMemory(repoPath, { version: PROJECT_MEMORY_VERSION, entries })
    return entry
  }

  private async readMemory(repoPath: string): Promise<ProjectMemoryFile> {
    try {
      const raw = await readFile(memoryFilePath(repoPath), 'utf-8')
      return parseMemoryFile(raw)
    } catch (error) {
      if (isMissingFileError(error)) {
        return { version: PROJECT_MEMORY_VERSION, entries: [] }
      }
      throw error
    }
  }

  private async writeMemory(repoPath: string, memory: ProjectMemoryFile): Promise<void> {
    const filePath = memoryFilePath(repoPath)

    if (memory.entries.length === 0) {
      await rm(filePath, { force: true })
      return
    }

    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(memory, null, 2)}\n`, 'utf-8')
  }
}

export const projectMemoryService = new ProjectMemoryService()

export function memoryFilePath(repoPath: string): string {
  return path.join(path.resolve(repoPath), MEMORY_DIR, MEMORY_FILE)
}

function parseMemoryFile(raw: string): ProjectMemoryFile {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Project memory file must be a JSON object')
  }

  const record = parsed as Record<string, unknown>
  if (record.version !== PROJECT_MEMORY_VERSION) {
    throw new Error(`Unsupported project memory version: ${String(record.version)}`)
  }
  if (!Array.isArray(record.entries)) {
    throw new Error('Project memory file entries must be an array')
  }

  return {
    version: PROJECT_MEMORY_VERSION,
    entries: record.entries.map(parseEntry),
  }
}

function parseEntry(value: unknown): ProjectKnowledgeEntry {
  if (!value || typeof value !== 'object') {
    throw new Error('Project memory entries must be objects')
  }

  const record = value as Record<string, unknown>
  const kind = normalizeKind(record.kind)
  const source = normalizeSource(record.source)
  const summary = requireNormalizedText(record.summary, 'Knowledge summary', MAX_SUMMARY_CHARS)
  const details = normalizeOptionalText(record.details, MAX_DETAILS_CHARS)
  const id = requireString(record.id, 'Knowledge id')
  const createdAt = requireNumber(record.createdAt, 'Knowledge createdAt')
  const updatedAt = requireNumber(record.updatedAt, 'Knowledge updatedAt')
  const sourceSessionId = normalizeOptionalText(record.sourceSessionId, 200)

  return {
    id,
    kind,
    summary,
    ...(details ? { details } : {}),
    source,
    ...(sourceSessionId ? { sourceSessionId } : {}),
    createdAt,
    updatedAt,
  }
}

function formatKnowledgeBlock(entries: ProjectKnowledgeEntry[]): string | null {
  const selected = entries.slice(0, MAX_PROMPT_ENTRIES)
  if (selected.length === 0) return null

  const lines = selected.flatMap((entry) => {
    const item = `- [${entry.kind}] ${entry.summary}`
    return entry.details ? [item, `  ${entry.details}`] : [item]
  })

  return `Project knowledge base (.lobrecs/memory.json):\n${lines.join('\n')}`
}

function normalizeKind(value: unknown): ProjectKnowledgeKind {
  return typeof value === 'string' && knowledgeKinds.has(value as ProjectKnowledgeKind)
    ? (value as ProjectKnowledgeKind)
    : 'general'
}

function normalizeSource(value: unknown): ProjectKnowledgeSource {
  return typeof value === 'string' && knowledgeSources.has(value as ProjectKnowledgeSource)
    ? (value as ProjectKnowledgeSource)
    : 'manual'
}

function requireNormalizedText(value: unknown, label: string, maxChars: number): string {
  const normalized = normalizeOptionalText(value, maxChars)
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function normalizeOptionalText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.length <= maxChars) return trimmed

  return trimmed.slice(0, maxChars).trimEnd()
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}

function entryKey(kind: ProjectKnowledgeKind, summary: string): string {
  return `${kind}:${summary.toLowerCase().replace(/\s+/g, ' ').trim()}`
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function requireProject(projectId: string) {
  const project = projectsStore.get(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  return project
}
