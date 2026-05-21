import type {
  RepositoryContextChunk,
  RepositoryContextStatus,
} from '../../../../shared/types'

export const CONTEXT_INDEX_STALE_AFTER_MS = 5 * 60 * 1000

export type ContextIndexState = 'empty' | 'fresh' | 'stale'

export function getContextIndexState(
  status: RepositoryContextStatus,
  now = Date.now(),
): ContextIndexState {
  if (status.indexedChunks === 0 || !status.updatedAt) return 'empty'
  if (now - status.updatedAt > CONTEXT_INDEX_STALE_AFTER_MS) return 'stale'
  return 'fresh'
}

export function clampContextScore(score: number): number {
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(100, Math.round(score * 100)))
}

export function hasSearchResults(results: readonly RepositoryContextChunk[]): boolean {
  return results.length > 0
}
