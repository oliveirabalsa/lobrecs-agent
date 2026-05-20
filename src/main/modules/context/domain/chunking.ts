import { createHash } from 'node:crypto'

const MAX_CHUNK_LINES = 90
const MAX_CHUNK_CHARS = 5_500
const OVERLAP_LINES = 8

export interface RepositoryFileSnapshot {
  path: string
  content: string
}

export interface RepositoryContextChunkInput {
  path: string
  startLine: number
  endLine: number
  content: string
  contentHash: string
}

export function chunkRepositoryFile(file: RepositoryFileSnapshot): RepositoryContextChunkInput[] {
  const lines = file.content.split(/\r?\n/)
  const chunks: RepositoryContextChunkInput[] = []
  let start = 0

  while (start < lines.length) {
    let end = Math.min(start + MAX_CHUNK_LINES, lines.length)
    let content = lines.slice(start, end).join('\n').trim()

    while (content.length > MAX_CHUNK_CHARS && end - start > 12) {
      end = Math.max(start + 12, end - 10)
      content = lines.slice(start, end).join('\n').trim()
    }

    if (content) {
      chunks.push({
        path: file.path,
        startLine: start + 1,
        endLine: end,
        content,
        contentHash: hashContent(content),
      })
    }

    if (end >= lines.length) break
    start = Math.max(end - OVERLAP_LINES, start + 1)
  }

  return chunks
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
