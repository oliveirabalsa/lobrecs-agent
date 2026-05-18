import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

export type ModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Title for the dialog. Always rendered (visually or sr-only) so screen
   * readers announce the dialog. Use `visualTitle={false}` to hide the heading
   * visually while keeping it accessible.
   */
  title?: ReactNode
  /** Optional description, sr-only by default. */
  description?: ReactNode
  /** When false, the title is rendered visually hidden (still announced). */
  visualTitle?: boolean
  /** Pixel cap for the card width. Defaults to 480. */
  maxWidth?: number
  children: ReactNode
  closeOnBackdrop?: boolean
  closeOnEsc?: boolean
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/**
 * Modal — Radix Dialog wrapper styled to match the Codex card primitive.
 * Uses a `<Dialog.Portal>` so it mounts at the document root regardless of
 * the call site's stacking context.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  visualTitle = true,
  maxWidth = 480,
  children,
  closeOnBackdrop = true,
  closeOnEsc = true,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out"
        />
        <Dialog.Content
          onPointerDownOutside={(event) => {
            if (!closeOnBackdrop) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            if (!closeOnBackdrop) event.preventDefault()
          }}
          onEscapeKeyDown={(event) => {
            if (!closeOnEsc) event.preventDefault()
          }}
          style={{ maxWidth }}
          className={cx(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[calc(100vw-32px)] bg-card rounded-card border border-hairline shadow-2xl',
            'p-5 font-ui text-primary outline-none',
          )}
        >
          {title != null &&
            (visualTitle ? (
              <Dialog.Title className="text-[15px] font-semibold leading-none mb-3">
                {title}
              </Dialog.Title>
            ) : (
              <Dialog.Title className="sr-only">{title}</Dialog.Title>
            ))}
          {description != null ? (
            <Dialog.Description className="sr-only">{description}</Dialog.Description>
          ) : null}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
