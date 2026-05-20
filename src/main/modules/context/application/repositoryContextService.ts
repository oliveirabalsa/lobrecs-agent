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

const DEFAULT_LIMIT = 6
const MAX_LIMIT = 12
const MAX_CONTEXT_CHARS = 12_000
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
    const chunks = await this.search({
      projectId: input.projectId,
      repoPath: input.repoPath,
      query: input.prompt,
      limit: DEFAULT_LIMIT,
    })

    if (chunks.length === 0) return null

    let usedChars = 0
    const rendered: string[] = []

    for (const chunk of chunks) {
      const header = `File: ${chunk.path}:${chunk.startLine}-${chunk.endLine}`
      const body = truncateSnippet(chunk.content, Math.max(800, MAX_CONTEXT_CHARS - usedChars))
      const block = `${header}\n${body}`

      if (usedChars + block.length > MAX_CONTEXT_CHARS && rendered.length > 0) break
      rendered.push(block)
      usedChars += block.length
    }

    if (rendered.length === 0) return null

    return [
      'Repository context (retrieved automatically; use only when relevant):',
      ...rendered.map((block) => `---\n${block}`),
    ].join('\n')
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

function truncateSnippet(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content

  return `${content.slice(0, maxChars).trimEnd()}\n[truncated]`
}
