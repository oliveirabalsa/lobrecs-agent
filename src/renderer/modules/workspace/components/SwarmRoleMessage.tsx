import { useState } from 'react'
import type { ImageAttachment } from '../../../../shared/types'
import { MarkdownContent } from './MarkdownContent'
import { SwarmRoleBadge } from './SwarmRoleBadge'

export interface SwarmRoleMessageProps {
  /** Role lifted from the `[Role: ...]` header. */
  role: string
  /** Prompt body with the role header already stripped. */
  body: string
  attachments?: ImageAttachment[]
}

/**
 * Right-aligned bubble for an auto-dispatched swarm worker prompt.
 *
 * These messages are machine-generated handoffs, not something the user
 * typed, so the long body (base task + previous-step context + role
 * instructions) is collapsed by default — the role badge and a short preview
 * are enough to scan the timeline.
 */
export function SwarmRoleMessage({ role, body, attachments }: SwarmRoleMessageProps) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = body.length > 0

  return (
    <div className="shadow-elevated ml-auto w-full max-w-[85%] overflow-hidden rounded-bubble bg-bubble-user sm:max-w-[70%]">
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
        <SwarmRoleBadge role={role} />
        <span className="ml-auto shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted">
          Swarm handoff
        </span>
      </div>

      <div className="px-4 py-3">
        {attachments && attachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <AttachmentThumb key={attachment.filePath} attachment={attachment} />
            ))}
          </div>
        ) : null}

        {!collapsible ? (
          <p className="text-sm leading-6 text-muted">No prompt details.</p>
        ) : expanded ? (
          <MarkdownContent text={body} variant="compact" />
        ) : (
          <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6 text-secondary">
            {body}
          </p>
        )}

        {collapsible ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-2 text-[11px] font-medium text-accent-primary hover:underline"
          >
            {expanded ? 'Hide prompt' : 'Show full prompt'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function AttachmentThumb({ attachment }: { attachment: ImageAttachment }) {
  const src = attachment.filePath.startsWith('file://')
    ? attachment.filePath
    : `file://${attachment.filePath}`
  const alt = attachment.name ?? attachment.filePath.split('/').pop() ?? 'attachment'

  return <img src={src} alt={alt} className="h-12 w-12 rounded object-cover" draggable={false} />
}
