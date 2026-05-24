import { AttachmentThumb } from '../AttachmentThumb'
import type { AttachedImage } from './types'

interface AttachmentStripProps {
  attachments: AttachedImage[]
  attaching: boolean
  onRemove: (id: string) => void
}

/**
 * Horizontal strip of 48px image thumbnails rendered above the textarea.
 * Click a tile to preview at full size; hover to reveal the remove button.
 */
export function AttachmentStrip({ attachments, attaching, onRemove }: AttachmentStripProps) {
  if (attachments.length === 0 && !attaching) return null

  return (
    <div className="flex items-center gap-2 px-3 pt-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        {attachments.map((image) => (
          <AttachmentThumb
            key={image.id}
            src={image.previewUrl}
            name={image.attachment.name}
            variant="framed"
            onRemove={() => onRemove(image.id)}
          />
        ))}
        {attaching ? (
          <span className="text-xs text-muted">Attaching image…</span>
        ) : null}
      </div>
    </div>
  )
}
