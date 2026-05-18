import { useCallback, type ReactNode } from 'react'
import { MarkdownContent } from './MarkdownContent'

export interface AssistantMessageProps {
  text: string
  /** When true, renders the trailing copy/feedback/share action row. */
  showActions?: boolean
  onCopy?: () => void
  onThumbsUp?: () => void
  onThumbsDown?: () => void
  onShare?: () => void
}

/**
 * Left-aligned assistant message (Codex shell §2.4). No bubble — text sits
 * directly on the canvas. Trailing actions only appear on the final
 * assistant message of a turn (controlled by parent).
 *
 * Assistant text is rendered as a safe markdown subset. We parse into React
 * nodes instead of injecting HTML so agent output stays untrusted text.
 */
export function AssistantMessage({
  text,
  showActions = false,
  onCopy,
  onThumbsUp,
  onThumbsDown,
  onShare,
}: AssistantMessageProps) {
  const handleCopy = useCallback(() => {
    if (onCopy) {
      onCopy()
      return
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text)
    }
  }, [onCopy, text])

  return (
    <div className="flex flex-col gap-2">
      <MarkdownContent text={text} />
      {showActions ? (
        <div className="flex items-center gap-1">
          <ActionButton label="Copy" onClick={handleCopy}>
            {iconCopy}
          </ActionButton>
          {onThumbsUp ? (
            <ActionButton label="Good response" onClick={onThumbsUp}>
              {iconThumbsUp}
            </ActionButton>
          ) : null}
          {onThumbsDown ? (
            <ActionButton label="Bad response" onClick={onThumbsDown}>
              {iconThumbsDown}
            </ActionButton>
          ) : null}
          {onShare ? (
            <ActionButton label="Share" onClick={onShare}>
              {iconShare}
            </ActionButton>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded text-secondary opacity-50 transition-opacity hover:bg-white/5 hover:opacity-100"
    >
      {children}
    </button>
  )
}

const iconCopy = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="4" y="4" width="9" height="9" rx="1.5" />
    <path d="M11 4V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1" />
  </svg>
)

const iconThumbsUp = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
    <path d="M6 13V8l2.2-5a1.3 1.3 0 0 1 2.5.6l-.7 2.4h3.1a1.5 1.5 0 0 1 1.5 1.8l-1 4A1.5 1.5 0 0 1 12.1 13H6Z" />
    <rect x="2.5" y="8" width="3" height="5" rx="0.5" />
  </svg>
)

const iconThumbsDown = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
    <path d="M10 3v5l-2.2 5a1.3 1.3 0 0 1-2.5-.6l.7-2.4H2.9a1.5 1.5 0 0 1-1.5-1.8l1-4A1.5 1.5 0 0 1 3.9 3H10Z" />
    <rect x="10.5" y="3" width="3" height="5" rx="0.5" />
  </svg>
)

const iconShare = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
    <path d="M11 5.5 8 2.5 5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 2.5v8.5" strokeLinecap="round" />
    <path d="M3.5 9v3.5A1.5 1.5 0 0 0 5 14h6a1.5 1.5 0 0 0 1.5-1.5V9" strokeLinecap="round" />
  </svg>
)
