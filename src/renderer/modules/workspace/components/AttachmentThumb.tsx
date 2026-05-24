import { useState } from 'react'
import type { ImageAttachment } from '../../../../shared/types'
import { ImagePreview } from '../../../components/ui'

export type AttachmentThumbProps = {
  src: string
  name?: string
  /** `framed` adds the canvas border used inside the composer strip. */
  variant?: 'bare' | 'framed'
  /** When provided, a hover-revealed remove (×) overlay appears. */
  onRemove?: () => void
}

/**
 * 48px attachment tile that opens a full-screen `ImagePreview` on click.
 * Used by user/swarm message bubbles and by the composer attachment strip.
 */
export function AttachmentThumb({ src, name, variant = 'bare', onRemove }: AttachmentThumbProps) {
  const [open, setOpen] = useState(false)
  const label = name ?? 'Attached image'

  const container =
    variant === 'framed'
      ? 'group relative h-12 w-12 shrink-0 overflow-hidden rounded border border-hairline bg-canvas'
      : 'group relative h-12 w-12 shrink-0 overflow-hidden rounded'

  return (
    <>
      <div className={container} title={label}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Preview ${label}`}
          className="block h-full w-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        >
          <img
            src={src}
            alt={label}
            className="h-full w-full object-cover"
            draggable={false}
          />
        </button>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${label}`}
            className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded-pill bg-black/80 text-[10px] leading-none text-white group-hover:flex"
          >
            ×
          </button>
        ) : null}
      </div>
      <ImagePreview open={open} onOpenChange={setOpen} src={src} alt={label} />
    </>
  )
}

export function resolveAttachmentSrc(attachment: ImageAttachment): string {
  return attachment.filePath.startsWith('file://')
    ? attachment.filePath
    : `file://${attachment.filePath}`
}

export function resolveAttachmentName(attachment: ImageAttachment): string {
  return attachment.name ?? attachment.filePath.split('/').pop() ?? 'attachment'
}
