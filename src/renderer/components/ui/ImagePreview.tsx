import * as Dialog from '@radix-ui/react-dialog'

export type ImagePreviewProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  src: string
  alt?: string
}

/**
 * Full-screen image lightbox. Backdrop dim + click-outside / ESC to close.
 * Unlike `Modal`, this renders bare — the image floats without card chrome
 * so it can scale to the viewport without fighting padding or a fixed width.
 */
export function ImagePreview({ open, onOpenChange, src, alt }: ImagePreviewProps) {
  const label = alt ?? 'Image preview'

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none"
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          <img
            src={src}
            alt={label}
            className="max-h-[90vh] max-w-[90vw] rounded-card object-contain shadow-2xl shadow-black/50"
            draggable={false}
          />
          <Dialog.Close
            aria-label="Close image preview"
            className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-pill bg-black/80 text-base leading-none text-white shadow-lg shadow-black/50 outline-none hover:bg-black/95 focus-visible:ring-2 focus-visible:ring-white/60"
          >
            ×
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
