import type { ImageAttachment } from '../../../../shared/types'
import { MarkdownContent } from './MarkdownContent'

export interface UserMessageProps {
  text: string
  attachments?: ImageAttachment[]
}

/**
 * Right-aligned user message bubble (Codex shell §2.4).
 *
 * User prompts use the same safe markdown renderer as assistant messages, but
 * in compact mode so headings and code blocks fit inside the bubble.
 */
export function UserMessage({ text, attachments }: UserMessageProps) {
  return (
    <div className="ml-auto max-w-[85%] rounded-bubble bg-bubble-user px-4 py-3 text-sm leading-6 text-primary sm:max-w-[70%]">
      {attachments && attachments.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <AttachmentThumb key={attachment.filePath} attachment={attachment} />
          ))}
        </div>
      ) : null}
      <MarkdownContent text={text} variant="compact" />
    </div>
  )
}

function AttachmentThumb({ attachment }: { attachment: ImageAttachment }) {
  const src = attachment.filePath.startsWith('file://')
    ? attachment.filePath
    : `file://${attachment.filePath}`
  const alt = attachment.name ?? attachment.filePath.split('/').pop() ?? 'attachment'
  return (
    <img
      src={src}
      alt={alt}
      className="h-12 w-12 rounded object-cover"
      draggable={false}
    />
  )
}
