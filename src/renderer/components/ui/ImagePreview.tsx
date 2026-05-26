import * as Dialog from '@radix-ui/react-dialog'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

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
  const resetTimerRef = useRef<number | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const [copying, setCopying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== undefined) {
        window.clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  const copyImage = useCallback(async () => {
    setError(null)
    setCopying(true)

    try {
      const source = await sourceForSystemImageAction(src)
      await window.agentforge.system.copyImageToClipboard({
        source,
        suggestedName: toImageFileName(label),
      })
      setCopied(true)
      if (resetTimerRef.current !== undefined) {
        window.clearTimeout(resetTimerRef.current)
      }
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 1_200)
    } catch (reason) {
      setError(errorMessage(reason, 'Unable to copy image.'))
    } finally {
      setCopying(false)
    }
  }, [label, src])

  const saveImage = useCallback(async () => {
    setError(null)
    setSaving(true)

    try {
      const source = await sourceForSystemImageAction(src)
      await window.agentforge.system.saveImageFile({
        source,
        suggestedName: toImageFileName(label),
      })
    } catch (reason) {
      setError(errorMessage(reason, 'Unable to save image.'))
    } finally {
      setSaving(false)
    }
  }, [label, src])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none"
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          <div className="flex max-h-[94vh] max-w-[94vw] flex-col items-center gap-3">
            <div className="flex shrink-0 items-center gap-1 rounded-pill border border-white/10 bg-black/75 p-1 shadow-lg shadow-black/40">
              <ImageActionButton
                label={copied ? 'Copied image' : 'Copy image'}
                disabled={copying || saving}
                onClick={copyImage}
              >
                {copied ? iconCheck : iconCopy}
              </ImageActionButton>
              <ImageActionButton
                label="Save image"
                disabled={copying || saving}
                onClick={saveImage}
              >
                {saving ? iconSpinner : iconDownload}
              </ImageActionButton>
            </div>
            <img
              src={src}
              alt={label}
              className="min-h-0 max-h-[calc(94vh-52px)] max-w-[94vw] rounded-card object-contain shadow-2xl shadow-black/50"
              draggable={false}
            />
            {error ? (
              <div
                role="alert"
                className="max-w-[min(90vw,520px)] rounded-card border border-red-300/30 bg-black/85 px-3 py-2 text-center text-xs leading-5 text-red-100 shadow-lg shadow-black/40"
              >
                {error}
              </div>
            ) : null}
          </div>
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

function ImageActionButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-pill text-white outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  )
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

function toImageFileName(label: string): string {
  const safe = label
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')

  return safe || 'image'
}

async function sourceForSystemImageAction(src: string): Promise<string> {
  if (!src.startsWith('blob:')) return src

  const response = await fetch(src)
  if (!response.ok) {
    throw new Error('Unable to read this image preview.')
  }

  return blobToDataUrl(await response.blob())
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Unable to read this image preview.'))
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Unable to read this image preview.'))
    }
    reader.readAsDataURL(blob)
  })
}

const iconCopy = (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="4" y="4" width="9" height="9" rx="1.5" />
    <path d="M11 4V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1" />
  </svg>
)

const iconDownload = (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4">
    <path d="M8 2.5v7" strokeLinecap="round" />
    <path d="m5.2 7.4 2.8 2.8 2.8-2.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3.2 11.5v1A1.5 1.5 0 0 0 4.7 14h6.6a1.5 1.5 0 0 0 1.5-1.5v-1" strokeLinecap="round" />
  </svg>
)

const iconCheck = (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="m3.2 8.4 3 3 6.6-6.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const iconSpinner = (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" className="animate-spin">
    <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
    <path d="M13.5 8A5.5 5.5 0 0 0 8 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)
