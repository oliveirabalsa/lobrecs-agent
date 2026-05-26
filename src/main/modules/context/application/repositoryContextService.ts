import type {
  RepositoryContextChunk,
  RepositoryContextIndexResult,
  RepositoryContextStatus,
} from '../../../../shared/types'
import { chunkRepositoryFile } from '../domain/chunking'
import { cosineSimilarity, embedText, tokenize } from '../domain/embedding'
import {
  contextRepository,
  toPublicChunk,
  tokensToString,
  type StoredRepositoryContextChunk,
} from '../infrastructure/contextRepository'
import { scanRepository } from '../infrastructure/repositoryScanner'
import { extractRepositorySymbolManifest } from '../infrastructure/symbolExtractor'
import { buildBoundedPromptContext, truncateForContext } from './contextBudget'
import { redactSensitiveText } from '../domain/secretRedaction'

const DEFAULT_LIMIT = 6
const MAX_LIMIT = 12
const MAX_REPOSITORY_CONTEXT_CHARS = 12_000
const MAX_CHUNK_CONTEXT_CHARS = 7_500
const MAX_SYMBOL_CONTEXT_CHARS = 4_500
const MAX_FILE_STRUCTURE_CHARS = 2_500
const COMPACT_SINGLE_FILE_CONTEXT_CHARS = 8_000
const COMPACT_SINGLE_FILE_CHUNKS = 3
const REINDEX_AFTER_MS = 5 * 60 * 1000
const MAX_CANDIDATE_PATHS = 200
const STALE_REINDEX_BATCH_DELAY_MS = 100
type ContextFreshness = 'blocking' | 'opportunistic'

export class RepositoryContextService {
  private readonly projectChunkCache = new Map<
    string,
    { updatedAt: number | null; chunks: StoredRepositoryContextChunk[] }
  >()
  private readonly symbolManifestCache = new Map<
    string,
    { value: string | null; updatedAt: number }
  >()
  private pendingReindex: Map<string, NodeJS.Timeout> = new Map()

  async indexProject(input: {
    projectId: string
    repoPath: string
  }): Promise<RepositoryContextIndexResult> {
    const scan = await scanRepository(input.repoPath)
    const updatedAt = Date.now()

    const candidateMap = new Map<string, { pathModified: number; contentTokens: Set<string> }>()
    const chunks: StoredRepositoryContextChunk[] = []

    for (const file of scan.files) {
      const fileChunks = chunkRepositoryFile(file)
      const contentTokens = new Set<string>()

      for (const chunk of fileChunks) {
        const chunkTokens = tokenize(chunk.content)
        for (const t of chunkTokens) contentTokens.add(t)

        chunks.push({
          projectId: input.projectId,
          path: chunk.path,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          contentHash: chunk.contentHash,
          embedding: embedText(`${chunk.path}\n${chunk.content}`),
          updatedAt,
        })
      }

      candidateMap.set(file.path, {
        pathModified: updatedAt,
        contentTokens,
      })
    }

    const candidates = [...candidateMap.entries()].map(([path, data]) => ({
      projectId: input.projectId,
      path,
      fileModifiedAt: data.pathModified,
      pathTokens: tokensToString(new Set(tokenize(path))),
      contentTokens: tokensToString(data.contentTokens),
    }))

    contextRepository.replaceProjectChunks(input.projectId, chunks)
    contextRepository.replaceProjectCandidates(input.projectId, candidates)

    this.projectChunkCache.set(input.projectId, { updatedAt, chunks })
    this.symbolManifestCache.delete(symbolCacheKey(input.repoPath))

    return {
      projectId: input.projectId,
      indexedFiles: scan.files.length,
      indexedChunks: chunks.length,
      skippedFiles: scan.skippedFiles,
      updatedAt,
    }
  }

  status(projectId: string): RepositoryContextStatus {
    return contextRepository.status(projectId)
  }

  async search(input: {
    projectId: string
    repoPath: string
    query: string
    limit?: number
    freshness?: ContextFreshness
  }): Promise<RepositoryContextChunk[]> {
    const hasIndex = await this.ensureFreshIndex(
      input.projectId,
      input.repoPath,
      input.freshness ?? 'blocking',
    )
    if (!hasIndex) return []

    const queryText = input.query.trim()
    if (!queryText) return []

    const queryEmbedding = embedText(queryText)
    const queryTokens = new Set(tokenize(queryText))
    const limit = clampLimit(input.limit)
    const freshness = input.freshness ?? 'blocking'

    const cached = this.projectChunkCache.get(input.projectId)
    const status = this.status(input.projectId)
    const hasCachedChunks = cached && cached.updatedAt === status.updatedAt

    if (!hasCachedChunks && freshness === 'opportunistic') {
      return []
    }

    let chunks: StoredRepositoryContextChunk[]
    if (hasCachedChunks) {
      const candidatePaths = contextRepository.findCandidatePaths(
        input.projectId,
        queryTokens,
        MAX_CANDIDATE_PATHS,
      )

      if (candidatePaths.length > 0) {
        chunks = contextRepository.listProjectChunksByPaths(input.projectId, candidatePaths)
      } else {
        chunks = cached!.chunks
      }
    } else {
      chunks = this.getProjectChunks(input.projectId, freshness)
    }

    return chunks
      .map((chunk) => ({
        chunk,
        score:
          cosineSimilarity(queryEmbedding, chunk.embedding) +
          lexicalScore(queryTokens, chunk) +
          pathScore(queryTokens, chunk.path),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((item) => toPublicChunk(item.chunk, item.score))
  }

  async buildPromptContext(input: {
    projectId: string
    repoPath: string
    prompt: string
    freshness?: ContextFreshness
  }): Promise<string | null> {
    const freshness = input.freshness ?? 'blocking'
    const hasIndex = await this.ensureFreshIndex(input.projectId, input.repoPath, freshness)
    const indexedChunks = hasIndex ? this.getProjectChunks(input.projectId, freshness) : []
    const [symbolManifest, chunks] = await Promise.all([
      this.getSymbolManifest(input.repoPath, freshness),
      this.search({
        projectId: input.projectId,
        repoPath: input.repoPath,
        query: input.prompt,
        limit: DEFAULT_LIMIT,
        freshness,
      }),
    ])

    return buildBoundedPromptContext(
      [
        {
          title: 'Repository symbol map (repo-wide; use before guessing filenames or APIs):',
          content: stripContextTitle(
            symbolManifest,
            'Repository symbol map (repo-wide; use before guessing filenames or APIs):',
          ),
          maxChars: MAX_SYMBOL_CONTEXT_CHARS,
        },
        {
          title: 'Repository file structure (current indexed files; inspect before planning):',
          content: renderFileStructure(indexedChunks),
          maxChars: MAX_FILE_STRUCTURE_CHARS,
        },
        {
          title: 'Repository context (retrieved automatically; use only when relevant):',
          content: renderChunkContext(chunks),
          maxChars: MAX_CHUNK_CONTEXT_CHARS,
        },
      ],
      { maxChars: MAX_REPOSITORY_CONTEXT_CHARS },
    )
  }

  private async ensureFreshIndex(
    projectId: string,
    repoPath: string,
    freshness: ContextFreshness,
  ): Promise<boolean> {
    const status = this.status(projectId)
    if (status.indexedChunks === 0 || !status.updatedAt) {
      if (freshness === 'opportunistic') return false

      await this.indexProject({ projectId, repoPath })
      return true
    }

    if (Date.now() - status.updatedAt > REINDEX_AFTER_MS) {
      if (freshness === 'opportunistic') return true

      if (!this.pendingReindex.has(projectId)) {
        this.scheduleBackgroundReindex(projectId, repoPath)
      }
      return true
    }

    return true
  }

  private scheduleBackgroundReindex(projectId: string, repoPath: string): void {
    const existing = this.pendingReindex.get(projectId)
    if (existing) clearTimeout(existing)

    const timeout = setTimeout(async () => {
      this.pendingReindex.delete(projectId)
      try {
        await this.indexProject({ projectId, repoPath })
      } catch {
        // Background reindex failed, will retry on next search if still stale
      }
    }, STALE_REINDEX_BATCH_DELAY_MS)

    this.pendingReindex.set(projectId, timeout)
  }

  private getProjectChunks(
    projectId: string,
    freshness: ContextFreshness,
  ): StoredRepositoryContextChunk[] {
    const status = this.status(projectId)
    const cached = this.projectChunkCache.get(projectId)

    if (cached && cached.updatedAt === status.updatedAt) return cached.chunks
    if (freshness === 'opportunistic') return []

    const chunks = contextRepository.listProjectChunks(projectId)
    this.projectChunkCache.set(projectId, { updatedAt: status.updatedAt, chunks })
    return chunks
  }

  private async getSymbolManifest(
    repoPath: string,
    freshness: ContextFreshness,
  ): Promise<string | null> {
    const key = symbolCacheKey(repoPath)
    const cached = this.symbolManifestCache.get(key)

    if (cached && Date.now() - cached.updatedAt <= REINDEX_AFTER_MS) {
      return cached.value
    }

    if (freshness === 'opportunistic') return cached?.value ?? null

    const value = await extractRepositorySymbolManifest(repoPath)
    this.symbolManifestCache.set(key, { value, updatedAt: Date.now() })
    return value
  }
}

export const repositoryContextService = new RepositoryContextService()

function renderChunkContext(chunks: readonly RepositoryContextChunk[]): string | null {
  if (chunks.length === 0) return null

  const compactSingleFileContext = compactContextForLargeSingleFile(chunks)
  if (compactSingleFileContext) return compactSingleFileContext

  let usedChars = 0
  const rendered: string[] = []

  for (const chunk of chunks) {
    const header = `File: ${chunk.path}:${chunk.startLine}-${chunk.endLine}`
    const body = truncateForContext(
      redactSensitiveText(chunk.content),
      Math.max(800, MAX_CHUNK_CONTEXT_CHARS - usedChars),
    )
    const block = `${header}\n${body}`

    if (usedChars + block.length > MAX_CHUNK_CONTEXT_CHARS && rendered.length > 0) break
    rendered.push(block)
    usedChars += block.length
  }

  if (rendered.length === 0) return null

  return rendered.map((block) => `---\n${block}`).join('\n')
}

function renderFileStructure(chunks: readonly StoredRepositoryContextChunk[]): string | null {
  if (chunks.length === 0) return null

  const paths = [...new Set(chunks.map((chunk) => chunk.path))].sort((left, right) =>
    left.localeCompare(right),
  )
  const lines = paths.map((filePath) => `- ${filePath}`)
  const rendered = lines.join('\n')

  return rendered.length <= MAX_FILE_STRUCTURE_CHARS
    ? rendered
    : `${rendered.slice(0, MAX_FILE_STRUCTURE_CHARS - 32).trimEnd()}\n[file structure truncated]`
}

function compactContextForLargeSingleFile(
  chunks: readonly RepositoryContextChunk[],
): string | null {
  const paths = new Set(chunks.map((chunk) => chunk.path))
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0)
  if (
    paths.size !== 1 ||
    chunks.length < COMPACT_SINGLE_FILE_CHUNKS ||
    totalChars < COMPACT_SINGLE_FILE_CONTEXT_CHARS
  ) {
    return null
  }

  const first = chunks[0]
  if (!first) return null
  const lastLine = Math.max(...chunks.map((chunk) => chunk.endLine))

  return [
    'Repository context (compact):',
    `Likely target file: ${first.path}:${first.startLine}-${lastLine}.`,
    'This project is dominated by one large file, so the full snippet was not injected.',
    'Read focused ranges from that file before editing to avoid duplicating large context.',
  ].join('\n')
}

function stripContextTitle(value: string | null, title: string): string | null {
  if (!value) return null
  return value.startsWith(title) ? value.slice(title.length).trim() : value
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit ?? DEFAULT_LIMIT)))
}

function symbolCacheKey(repoPath: string): string {
  return repoPath
}

function lexicalScore(
  queryTokens: ReadonlySet<string>,
  chunk: StoredRepositoryContextChunk,
): number {
  if (queryTokens.size === 0) return 0

  const contentTokens = new Set(tokenize(chunk.content))
  let matches = 0

  for (const token of queryTokens) {
    if (contentTokens.has(token)) matches += 1
  }

  return matches / queryTokens.size
}

function pathScore(queryTokens: ReadonlySet<string>, filePath: string): number {
  const pathTokens = new Set(tokenize(filePath))
  let matches = 0

  for (const token of queryTokens) {
    if (pathTokens.has(token)) matches += 1
  }

  return matches * 0.2
}
