import { describe, expect, it } from 'vitest'
import {
  CONTEXT_INDEX_STALE_AFTER_MS,
  clampContextScore,
  getContextIndexState,
  hasSearchResults,
} from './contextExplorerState'

describe('context explorer state', () => {
  it('marks missing indexes as empty', () => {
    expect(
      getContextIndexState({
        projectId: 'project-1',
        indexedChunks: 0,
        indexedFiles: 0,
        updatedAt: null,
      }),
    ).toBe('empty')
  })

  it('marks old indexes as stale', () => {
    expect(
      getContextIndexState(
        {
          projectId: 'project-1',
          indexedChunks: 12,
          indexedFiles: 4,
          updatedAt: 1_000,
        },
        1_000 + CONTEXT_INDEX_STALE_AFTER_MS + 1,
      ),
    ).toBe('stale')
  })

  it('keeps recent indexed repositories fresh', () => {
    expect(
      getContextIndexState(
        {
          projectId: 'project-1',
          indexedChunks: 12,
          indexedFiles: 4,
          updatedAt: 1_000,
        },
        1_000 + CONTEXT_INDEX_STALE_AFTER_MS - 1,
      ),
    ).toBe('fresh')
  })

  it('formats scores as bounded percentages', () => {
    expect(clampContextScore(0.42)).toBe(42)
    expect(clampContextScore(2)).toBe(100)
    expect(clampContextScore(Number.NaN)).toBe(0)
  })

  it('detects whether search has results', () => {
    expect(hasSearchResults([])).toBe(false)
    expect(
      hasSearchResults([
        {
          projectId: 'project-1',
          path: 'src/app.ts',
          startLine: 1,
          endLine: 4,
          content: 'const app = true',
          score: 0.5,
        },
      ]),
    ).toBe(true)
  })
})
