import type { AttachedImage } from './types'

interface AttachmentStripProps {
  attachments: AttachedImage[]
  attaching: boolean
  onRemove: (id: string) => void
}

/**
 * Horizontal strip of 48px image thumbnails rendered above the textarea.
 * Each thumbnail has a hover-to-reveal remove button.
 */
export function AttachmentStrip({ attachments, attaching, onRemove }: AttachmentStripProps) {
  if (attachments.length === 0 && !attaching) return null

  return (
    <div className="flex items-center gap-2 px-3 pt-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        {attachments.map((image) => (
          <div
            key={image.id}
            className="group relative h-12 w-12 shrink-0 overflow-hidden rounded border border-hairline bg-canvas"
            title={image.attachment.name}
          >
            <img
              src={image.previewUrl}
              alt={image.attachment.name ?? 'Attached image'}
              className="h-full w-full object-cover"
            />
            <button
              type="button"
              onClick={() => onRemove(image.id)}
              className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded-pill bg-black/80 text-[10px] leading-none text-white group-hover:flex"
              aria-label={`Remove ${image.attachment.name ?? 'image'}`}
            >
              ×
            </button>
          </div>
        ))}
        {attaching ? (
          <span className="text-xs text-muted">Attaching image…</span>
        ) : null}
      </div>
    </div>
  )
}
