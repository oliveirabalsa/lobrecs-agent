import { useRef, type ChangeEvent } from 'react'
import { Button } from '../../../../components/ui'

interface AttachButtonProps {
  disabled?: boolean
  /** Max attachments allowed; used to gate the picker. */
  remainingSlots: number
  onFilesSelected: (files: File[]) => void
}

/**
 * Ghost `+` button that opens a hidden file picker for image attachments.
 * Mirrors the paste-to-attach flow handled inline on the textarea.
 */
export function AttachButton({ disabled, remainingSlots, onFilesSelected }: AttachButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  function openPicker() {
    if (disabled || remainingSlots <= 0) return
    inputRef.current?.click()
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) =>
      file.type.startsWith('image/'),
    )
    if (files.length > 0) {
      onFilesSelected(files.slice(0, remainingSlots))
    }
    // Reset so picking the same file twice still fires `change`.
    event.target.value = ''
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        leadingIcon={<PlusIcon />}
        aria-label="Attach images"
        onClick={openPicker}
        disabled={disabled || remainingSlots <= 0}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleChange}
        tabIndex={-1}
      />
    </>
  )
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}
