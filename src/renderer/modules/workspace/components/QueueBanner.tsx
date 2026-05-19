import type { QueuedMessage } from '../../../../shared/types'

interface QueueBannerProps {
  messages: QueuedMessage[]
  onRemove: (id: string) => void | Promise<void>
  onClearAll: () => void | Promise<void>
}

/**
 * Slim banner shown above the Composer when the active thread has queued
 * messages waiting for the running session to finish. Displays a count + a
 * preview of the next prompt, and lets the user remove the single queued
 * message or clear them all.
 */
export function QueueBanner({ messages, onRemove, onClearAll }: QueueBannerProps) {
  if (messages.length === 0) return null

  const [first] = messages
  const previewLimit = 55
  const preview =
    first.prompt.length > previewLimit
      ? `${first.prompt.slice(0, previewLimit).trimEnd()}…`
      : first.prompt

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-t border-hairline bg-canvas px-3 py-1.5 text-[11px]"
    >
      <span className="shrink-0 rounded bg-accent-warn/15 px-1.5 py-0.5 font-medium text-accent-warn">
        {messages.length} queued
      </span>
      <span className="min-w-0 flex-1 truncate text-muted" title={first.prompt}>
        {preview}
      </span>
      {messages.length === 1 ? (
        <button
          type="button"
          onClick={() => void onRemove(first.id)}
          className="shrink-0 rounded px-1.5 py-0.5 text-muted transition-colors hover:bg-white/5 hover:text-primary"
        >
          Remove
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void onClearAll()}
          className="shrink-0 rounded px-1.5 py-0.5 text-muted transition-colors hover:bg-white/5 hover:text-primary"
        >
          Clear all
        </button>
      )}
    </div>
  )
}
