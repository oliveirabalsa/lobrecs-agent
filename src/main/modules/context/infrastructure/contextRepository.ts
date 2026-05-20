import type { RepositoryContextChunk, RepositoryContextStatus } from '../../../../shared/types'
import { getDb } from '../../../store'
import type { TextEmbedding } from '../domain/embedding'

export interface StoredRepositoryContextChunk {
  projectId: string
  path: string
  startLine: number
  endLine: number
  content: string
  contentHash: string
  embedding: TextEmbedding
  updatedAt: number
}

interface ContextChunkRow {
  project_id: string
  path: string
  start_line: number
  end_line: number
  content: string
  content_hash: string
  embedding: string
  updated_at: number
}

export const contextRepository = {
  replaceProjectChunks(projectId: string, chunks: StoredRepositoryContextChunk[]): void {
    const db = getDb()
    const replace = db.prepare(`
      INSERT INTO project_context_chunks (
        project_id, path, start_line, end_line, content, content_hash, embedding, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const write = db.transaction((items: StoredRepositoryContextChunk[]) => {
      db.prepare('DELETE FROM project_context_chunks WHERE project_id = ?').run(projectId)

      for (const item of items) {
        replace.run(
          item.projectId,
          item.path,
          item.startLine,
          item.endLine,
          item.content,
          item.contentHash,
          JSON.stringify(item.embedding),
          item.updatedAt,
        )
      }
    })

    write(chunks)
  },

  listProjectChunks(projectId: string): StoredRepositoryContextChunk[] {
    const rows = getDb()
      .prepare(
        `
          SELECT * FROM project_context_chunks
          WHERE project_id = ?
          ORDER BY path ASC, start_line ASC
        `,
      )
      .all(projectId) as ContextChunkRow[]

    return rows.map(rowToStoredChunk)
  },

  status(projectId: string): RepositoryContextStatus {
    const row = getDb()
      .prepare(
        `
          SELECT
            COUNT(*) AS indexed_chunks,
            COUNT(DISTINCT path) AS indexed_files,
            MAX(updated_at) AS updated_at
          FROM project_context_chunks
          WHERE project_id = ?
        `,
      )
      .get(projectId) as
      | {
          indexed_chunks: number
          indexed_files: number
          updated_at: number | null
        }
      | undefined

    return {
      projectId,
      indexedChunks: row?.indexed_chunks ?? 0,
      indexedFiles: row?.indexed_files ?? 0,
      updatedAt: row?.updated_at ?? null,
    }
  },
}

export function toPublicChunk(
  chunk: StoredRepositoryContextChunk,
  score: number,
): RepositoryContextChunk {
  return {
    projectId: chunk.projectId,
    path: chunk.path,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    content: chunk.content,
    score,
  }
}

function rowToStoredChunk(row: ContextChunkRow): StoredRepositoryContextChunk {
  return {
    projectId: row.project_id,
    path: row.path,
    startLine: row.start_line,
    endLine: row.end_line,
    content: row.content,
    contentHash: row.content_hash,
    embedding: parseEmbedding(row.embedding),
    updatedAt: row.updated_at,
  }
}

function parseEmbedding(value: string): TextEmbedding {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'number')
      ? parsed
      : []
  } catch {
    return []
  }
}
