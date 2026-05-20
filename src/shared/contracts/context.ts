export interface RepositoryContextChunk {
  projectId: string
  path: string
  startLine: number
  endLine: number
  content: string
  score: number
}

export interface RepositoryContextIndexResult {
  projectId: string
  indexedFiles: number
  indexedChunks: number
  skippedFiles: number
  updatedAt: number
}

export interface RepositoryContextStatus {
  projectId: string
  indexedChunks: number
  indexedFiles: number
  updatedAt: number | null
}

export interface RepositoryContextSearchParams {
  projectId: string
  query: string
  limit?: number
}
