import { useState } from 'react'
import type { ImageAttachment } from '../../../../shared/types'
import { ImagePreview } from '../../../components/ui'

export type AttachmentThumbProps = {
  /** Image preview URL. Absent for non-image files, which render as a chip. */
  src?: string
  name?: string
  /** `framed` adds the canvas border used inside the composer strip. */
  variant?: 'bare' | 'framed'
  /** When provided, a hover-revealed remove (×) overlay appears. */
  onRemove?: () => void
}

/**
 * 48px attachment tile. Images open a full-screen `ImagePreview` on click;
 * non-image files (no `src`) render as a labelled file chip instead. Used by
 * user/swarm message bubbles and by the composer attachment strip.
 */
export function AttachmentThumb({ src, name, variant = 'bare', onRemove }: AttachmentThumbProps) {
  const [open, setOpen] = useState(false)
  const label = name ?? 'Attachment'

  const container =
    variant === 'framed'
      ? 'group relative h-12 w-12 shrink-0 overflow-hidden rounded border border-hairline bg-canvas'
      : 'group relative h-12 w-12 shrink-0 overflow-hidden rounded'

  const removeButton = onRemove ? (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${label}`}
      className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded-pill bg-black/80 text-[10px] leading-none text-white group-hover:flex"
    >
      ×
    </button>
  ) : null

  if (!src) {
    return (
      <div className={`${container} flex flex-col items-center justify-center gap-0.5 px-1`} title={label}>
        <FileIcon />
        <span className="w-full truncate text-center text-[8px] leading-none text-muted">
          {fileExtensionLabel(label)}
        </span>
        {removeButton}
      </div>
    )
  }

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
        {removeButton}
      </div>
      <ImagePreview open={open} onOpenChange={setOpen} src={src} alt={label} />
    </>
  )
}

/** Upper-cased file extension (or `FILE`) shown under the file-chip icon. */
function fileExtensionLabel(name: string): string {
  const ext = name.split('.').pop()
  return ext && ext !== name ? ext.slice(0, 4).toUpperCase() : 'FILE'
}

function FileIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-muted"
    >
      <path d="M14 3v5h5" />
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    </svg>
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
