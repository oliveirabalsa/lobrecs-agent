import { useEffect, useMemo, useRef, useState } from 'react'
import type { ThreadSearchResult } from '../../../shared/types'
import { Modal, Spinner } from '../ui'

interface SearchPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenResult: (result: ThreadSearchResult) => void | Promise<void>
}

export function SearchPalette({ open, onOpenChange, onOpenResult }: SearchPaletteProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ThreadSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const normalizedQuery = useMemo(() => query.trim(), [query])

  useEffect(() => {
    if (!open) return

    setError(null)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      window.agentforge.threads
        .search({ query: normalizedQuery, limit: 40 })
        .then((items) => {
          if (cancelled) return
          setResults(items)
          setActiveIndex(0)
          setError(null)
        })
        .catch((searchError: unknown) => {
          if (cancelled) return
          setResults([])
          setError(searchError instanceof Error ? searchError.message : 'Search failed')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 120)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [normalizedQuery, open])

  async function openResult(result: ThreadSearchResult) {
    await onOpenResult(result)
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search projects and threads"
      maxWidth={680}
      visualTitle={false}
    >
      <div className="flex h-[520px] max-h-[calc(100vh-96px)] min-h-0 flex-col overflow-hidden">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hairline px-3">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => Math.max(index - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const result = results[activeIndex]
                if (result) void openResult(result)
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-primary outline-none placeholder:text-muted"
            placeholder="Search"
            aria-label="Search threads"
          />
          {loading ? <Spinner size={12} /> : null}
          <kbd className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-muted">
            esc
          </kbd>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {error ? (
            <div className="mx-2 rounded-card border border-accent-del/40 bg-accent-del/10 px-3 py-2 text-xs text-accent-del">
              {error}
            </div>
          ) : results.length > 0 ? (
            <div role="listbox" aria-label="Search results" className="px-2">
              {results.map((result, index) => (
                <button
                  key={result.thread.id}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => void openResult(result)}
                  className={`flex w-full min-w-0 flex-col gap-1 rounded-card px-3 py-2 text-left transition-colors ${
                    index === activeIndex
                      ? 'bg-white/10 text-primary'
                      : 'text-secondary hover:bg-white/5 hover:text-primary'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{result.thread.title}</span>
                    <span className="shrink-0 rounded border border-hairline px-1.5 py-0.5 text-[10px] capitalize text-muted">
                      {result.matchKind}
                    </span>
                  </span>
                  <span className="truncate text-[11px] text-muted">{result.project.name}</span>
                  {result.matchText ? (
                    <span className="line-clamp-2 text-[12px] leading-5 text-secondary">
                      {result.matchText}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-center text-[13px] text-muted">No results</div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function SearchIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-muted"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}
