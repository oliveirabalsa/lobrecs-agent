import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { AgentActivity } from '../../../../shared/types'
import { Divider } from '../../../components/ui'
import { groupTurns, type StreamItem, type Turn, type TurnUserMessage } from '../lib/groupTurns'
import {
  renderStreamItem,
  type RendererContext,
} from '../lib/activityRenderers'
import { CompletionFooter } from './artifacts'
import { AssistantMessage } from './AssistantMessage'
import { UserMessage } from './UserMessage'
import { WorkingState } from './WorkingState'

export interface MessageStreamProps {
  activities: AgentActivity[]
  activityTimes?: number[]
  loading?: boolean
  running?: boolean
  sessionId: string | null
  seedUserMessage?: TurnUserMessage
  /**
   * Live state + callbacks the inline artifacts need (diff proposals,
   * approval handlers, right-panel toggle). Threaded into the dispatch table
   * so each artifact stays a pure presentation component.
   */
  streamHandlers?: Omit<RendererContext, 'sessionId' | 'running'>
}

const STICKY_THRESHOLD_PX = 80

interface AutoPinState {
  loading: boolean
  running: boolean
  sticky: boolean
}

export function shouldPinMessageStream({
  loading,
  running,
  sticky,
}: AutoPinState): boolean {
  return running || loading || sticky
}

function getScrollElement(container: HTMLDivElement | null): HTMLElement | null {
  if (!container) return null
  const ancestor = container.closest('[data-workspace-scroll="true"]')
  return ancestor instanceof HTMLElement ? ancestor : container
}

function pinToBottom(element: HTMLElement): () => void {
  element.scrollTop = element.scrollHeight

  let cleanup: () => void = () => undefined
  const firstFrame = window.requestAnimationFrame(() => {
    element.scrollTop = element.scrollHeight
    const secondFrame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight
    })
    cleanup = () => window.cancelAnimationFrame(secondFrame)
  })

  cleanup = () => window.cancelAnimationFrame(firstFrame)
  return () => cleanup()
}

/**
 * MessageStream — vertical, max-width-820, sticky-scroll Codex stream.
 *
 * Scroll behavior: we measure how close the user is to the bottom before each
 * update; if they're within `STICKY_THRESHOLD_PX`, we re-pin to the bottom
 * after the next paint. Scrolling away cancels the auto-pin.
 */
export function MessageStream({
  activities,
  activityTimes,
  loading = false,
  running = false,
  sessionId,
  seedUserMessage,
  streamHandlers,
}: MessageStreamProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const isStickyRef = useRef(true)
  const fallbackNow = useMemo(
    () => seedUserMessage?.at ?? Date.now(),
    [sessionId, seedUserMessage?.at],
  )

  const turns = useMemo(
    () => groupTurns(activities, { seedUserMessage, activityTimes, now: fallbackNow }),
    [activities, activityTimes, fallbackNow, seedUserMessage],
  )

  // Track scroll proximity to bottom.
  useEffect(() => {
    const element = getScrollElement(containerRef.current)
    if (!element) return
    const handleScroll = () => {
      const distanceFromBottom =
        element.scrollHeight - (element.scrollTop + element.clientHeight)
      isStickyRef.current = distanceFromBottom <= STICKY_THRESHOLD_PX
    }
    element.addEventListener('scroll', handleScroll, { passive: true })
    return () => element.removeEventListener('scroll', handleScroll)
  }, [])

  // Re-pin to bottom after content changes. Running sessions are forced to the
  // latest output because the primary workflow is watching the active turn.
  useLayoutEffect(() => {
    const element = getScrollElement(containerRef.current)
    if (!element) return
    const shouldPin = shouldPinMessageStream({
      loading,
      running,
      sticky: isStickyRef.current,
    })
    if (!shouldPin) return

    if (running || loading) {
      isStickyRef.current = true
    }

    return pinToBottom(element)
  }, [activities.length, loading, running, turns])

  // Keep the active turn pinned when rendered height changes after the first
  // paint, such as markdown/code blocks or async thread context above it.
  useLayoutEffect(() => {
    const content = containerRef.current
    const element = getScrollElement(content)
    if (!content || !element || typeof ResizeObserver === 'undefined') return

    let cleanupPin: (() => void) | undefined
    const pinIfNeeded = () => {
      const shouldPin = shouldPinMessageStream({
        loading,
        running,
        sticky: isStickyRef.current,
      })
      if (!shouldPin) return

      if (running || loading) {
        isStickyRef.current = true
      }

      cleanupPin?.()
      cleanupPin = pinToBottom(element)
    }

    const observer = new ResizeObserver(pinIfNeeded)
    const observedElements = new Set<HTMLElement>([content])
    const scrollContent = element.firstElementChild
    if (scrollContent instanceof HTMLElement) {
      observedElements.add(scrollContent)
    }

    observedElements.forEach((observedElement) => observer.observe(observedElement))

    return () => {
      cleanupPin?.()
      observer.disconnect()
    }
  }, [loading, running, sessionId, turns.length])

  // Reset stickiness when the session id changes (jump to bottom of new stream).
  useEffect(() => {
    isStickyRef.current = true
    const element = getScrollElement(containerRef.current)
    if (element) {
      return pinToBottom(element)
    }
  }, [sessionId])

  if (loading && activities.length === 0 && !seedUserMessage) {
    return (
      <div ref={containerRef} className="flex w-full justify-center py-8">
        <StreamSkeleton />
      </div>
    )
  }

  if (turns.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex h-full items-center justify-center text-sm text-muted"
      >
        Waiting for agent output...
      </div>
    )
  }

  return (
    <div ref={containerRef} className="mx-auto flex w-full max-w-[820px] flex-col gap-4">
      {turns.map((turn, index) => {
        const isLastTurn = index === turns.length - 1
        const isRunning = isLastTurn ? running : false
        const ctx: RendererContext = {
          sessionId,
          running: isRunning,
          ...(streamHandlers ?? {}),
        }
        return (
          <TurnBlock
            key={turn.id}
            turn={turn}
            isLast={isLastTurn}
            running={isRunning}
            ctx={ctx}
          />
        )
      })}
    </div>
  )
}

function TurnBlock({
  turn,
  isLast,
  running,
  ctx,
}: {
  turn: Turn
  isLast: boolean
  running: boolean
  ctx: RendererContext
}) {
  const isCompactionTurn =
    turn.streamItems.length === 1 && turn.streamItems[0].kind === 'compaction'

  if (isCompactionTurn) {
    return <Divider label="Context automatically compacted" />
  }

  const { renderable, finalAssistantText } = splitFinalAssistant(turn.streamItems, {
    separateFinalAssistant: !running && turn.completion !== undefined,
  })
  const showWorkingState = running || turn.completion !== undefined
  const totalMs =
    turn.endedAt !== undefined ? Math.max(0, turn.endedAt - turn.startedAt) : undefined

  const completion = turn.completion
  const hasCompletionMetrics =
    completion !== undefined &&
    (completion.tokensIn !== undefined ||
      completion.tokensOut !== undefined ||
      completion.costUsd !== undefined ||
      totalMs !== undefined)

  return (
    <section className="flex flex-col gap-3">
      {turn.userMessage ? (
        <UserMessage
          text={turn.userMessage.text}
          attachments={
            turn.userMessage.attachments as
              | Parameters<typeof UserMessage>[0]['attachments']
              | undefined
          }
        />
      ) : null}

      {renderable.length > 0 ? (
        <div className="flex flex-col gap-2">
          {renderable.map((item, idx) =>
            renderStreamItem(item, `${turn.id}-${idx}`, ctx),
          )}
        </div>
      ) : null}

      {showWorkingState ? (
        <WorkingState startedAt={turn.startedAt} running={running} totalMs={totalMs} />
      ) : null}

      {finalAssistantText !== undefined ? (
        <AssistantMessage text={finalAssistantText} showActions={isLast && !running} />
      ) : null}

      {hasCompletionMetrics ? (
        <CompletionFooter
          tokensIn={completion?.tokensIn}
          tokensOut={completion?.tokensOut}
          costUsd={completion?.costUsd}
          durationMs={totalMs}
        />
      ) : null}
    </section>
  )
}

interface FinalAssistantSplit {
  renderable: StreamItem[]
  finalAssistantText?: string
}

/**
 * The Codex layout puts the WorkingState pill *between* tool output and the
 * final assistant response. We pull the final assistant message out of the
 * stream items so the order is:
 *
 *   user bubble → tool/command artifacts → "Worked for Xs" → final answer.
 *
 * `completion` items are also filtered out — they're rendered as a separate
 * footer below the assistant message.
 */
export function splitFinalAssistant(
  items: StreamItem[],
  options: { separateFinalAssistant?: boolean } = {},
): FinalAssistantSplit {
  const completionlessItems = items.filter((item) => item.kind !== 'completion')
  if (options.separateFinalAssistant === false) {
    return { renderable: completionlessItems }
  }

  let lastAssistantIndex = -1
  let lastAssistantText: string | undefined
  for (let i = completionlessItems.length - 1; i >= 0; i -= 1) {
    const item = completionlessItems[i]
    if (item.kind === 'message' && item.role === 'assistant') {
      lastAssistantIndex = i
      lastAssistantText = item.text
      break
    }
  }

  if (lastAssistantIndex === -1) {
    return {
      renderable: completionlessItems,
    }
  }

  const renderable = completionlessItems.filter((_, index) => index !== lastAssistantIndex)
  return { renderable, finalAssistantText: lastAssistantText }
}

function StreamSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-3">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="h-20 animate-pulse rounded-card border border-hairline bg-card"
        />
      ))}
    </div>
  )
}
