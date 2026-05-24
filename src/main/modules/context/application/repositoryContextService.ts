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
const COMPACT_SINGLE_FILE_CONTEXT_CHARS = 8_000
const COMPACT_SINGLE_FILE_CHUNKS = 3
const REINDEX_AFTER_MS = 5 * 60 * 1000

export class RepositoryContextService {
  async indexProject(input: {
    projectId: string
    repoPath: string
  }): Promise<RepositoryContextIndexResult> {
    const scan = await scanRepository(input.repoPath)
    const updatedAt = Date.now()
    const chunks: StoredRepositoryContextChunk[] = scan.files.flatMap((file) =>
      chunkRepositoryFile(file).map((chunk) => ({
        projectId: input.projectId,
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        content: chunk.content,
        contentHash: chunk.contentHash,
        embedding: embedText(`${chunk.path}\n${chunk.content}`),
        updatedAt,
      })),
    )

    contextRepository.replaceProjectChunks(input.projectId, chunks)

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
  }): Promise<RepositoryContextChunk[]> {
    await this.ensureFreshIndex(input.projectId, input.repoPath)
    const query = input.query.trim()
    if (!query) return []

    const queryEmbedding = embedText(query)
    const queryTokens = new Set(tokenize(query))
    const limit = clampLimit(input.limit)

    return contextRepository
      .listProjectChunks(input.projectId)
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
  }): Promise<string | null> {
    const [symbolManifest, chunks] = await Promise.all([
      extractRepositorySymbolManifest(input.repoPath),
      this.search({
        projectId: input.projectId,
        repoPath: input.repoPath,
        query: input.prompt,
        limit: DEFAULT_LIMIT,
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
          title: 'Repository context (retrieved automatically; use only when relevant):',
          content: renderChunkContext(chunks),
          maxChars: MAX_CHUNK_CONTEXT_CHARS,
        },
      ],
      { maxChars: MAX_REPOSITORY_CONTEXT_CHARS },
    )
  }

  private async ensureFreshIndex(projectId: string, repoPath: string): Promise<void> {
    const status = this.status(projectId)
    if (status.indexedChunks === 0 || !status.updatedAt) {
      await this.indexProject({ projectId, repoPath })
      return
    }

    if (Date.now() - status.updatedAt > REINDEX_AFTER_MS) {
      await this.indexProject({ projectId, repoPath })
    }
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
