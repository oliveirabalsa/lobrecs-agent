import { useCallback, useMemo, useState } from 'react'

/**
 * In-memory back/forward stack for workspace navigation (thread switches).
 * Not persisted across sessions; reset on every app launch.
 *
 * - `push(threadId)` advances history (and truncates any forward stack
 *   beyond the current cursor, mirroring browser-history semantics).
 * - `back()` / `forward()` move the cursor without mutating the stack and
 *   return the threadId now active (or null if at boundary).
 */
export interface WorkspaceHistory {
  current: string | null
  canGoBack: boolean
  canGoForward: boolean
  push(threadId: string): void
  back(): string | null
  forward(): string | null
  reset(): void
}

export function useWorkspaceHistory(): WorkspaceHistory {
  const [stack, setStack] = useState<string[]>([])
  const [cursor, setCursor] = useState<number>(-1)

  const push = useCallback((threadId: string) => {
    setStack((prev) => {
      const trimmed = cursor >= 0 ? prev.slice(0, cursor + 1) : []
      // Avoid stacking duplicates when re-pushing the current thread.
      if (trimmed.at(-1) === threadId) return trimmed
      const next = [...trimmed, threadId]
      setCursor(next.length - 1)
      return next
    })
  }, [cursor])

  const back = useCallback((): string | null => {
    if (cursor <= 0) return null
    const nextCursor = cursor - 1
    setCursor(nextCursor)
    return stack[nextCursor] ?? null
  }, [cursor, stack])

  const forward = useCallback((): string | null => {
    if (cursor < 0 || cursor >= stack.length - 1) return null
    const nextCursor = cursor + 1
    setCursor(nextCursor)
    return stack[nextCursor] ?? null
  }, [cursor, stack])

  const reset = useCallback(() => {
    setStack([])
    setCursor(-1)
  }, [])

  return useMemo<WorkspaceHistory>(
    () => ({
      current: cursor >= 0 ? stack[cursor] ?? null : null,
      canGoBack: cursor > 0,
      canGoForward: cursor >= 0 && cursor < stack.length - 1,
      push,
      back,
      forward,
      reset,
    }),
    [back, cursor, forward, push, reset, stack],
  )
}
