import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Button, Modal } from '../../../../components/ui'

export type PlanPromptOption = {
  id: string
  label: string
}

export type PlanPromptModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  options: PlanPromptOption[]
  /**
   * When true, selecting the *last* option reveals an inline textarea and
   * disables submit until the user enters non-empty feedback.
   */
  allowFreeText?: boolean
  onDecision: (optionId: string, freeText?: string) => void
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/**
 * PlanPromptModal — the Codex-style "Implement this plan?" modal.
 *
 * Keyboard contract:
 *   - Digits 1–9 select the matching option. If `allowFreeText` is true *and*
 *     the digit picks the last option, selection focuses the textarea
 *     instead of submitting; otherwise the decision is submitted immediately.
 *   - ↑/↓ navigate selection.
 *   - Enter submits the current selection (requires non-empty textarea when
 *     the free-text branch is active).
 *   - Escape closes via `onOpenChange(false)`.
 */
export function PlanPromptModal({
  open,
  onOpenChange,
  title,
  options,
  allowFreeText = false,
  onDecision,
}: PlanPromptModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [freeText, setFreeText] = useState('')
  const contentRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const lastIndex = options.length - 1
  const showFreeText = useMemo(
    () => allowFreeText && options.length > 0 && selectedIndex === lastIndex,
    [allowFreeText, options.length, selectedIndex, lastIndex],
  )
  const submitDisabled = showFreeText && freeText.trim().length === 0

  // Reset state + focus container whenever the modal opens.
  useEffect(() => {
    if (!open) return
    setSelectedIndex(0)
    setFreeText('')
    // Defer focus so Radix has time to mount the content.
    requestAnimationFrame(() => {
      contentRef.current?.focus()
    })
  }, [open])

  // When the textarea is revealed move focus into it so users can type
  // without an extra Tab press.
  useEffect(() => {
    if (showFreeText) {
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [showFreeText])

  function submit(index: number, text: string): void {
    const option = options[index]
    if (!option) return
    const trailing = allowFreeText && index === lastIndex ? text.trim() : undefined
    if (allowFreeText && index === lastIndex && !trailing) return
    onDecision(option.id, trailing && trailing.length > 0 ? trailing : undefined)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((current) => Math.min(current + 1, lastIndex))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((current) => Math.max(current - 1, 0))
      return
    }

    if (event.key === 'Enter') {
      // Allow newlines inside the textarea unless Cmd/Ctrl-Enter explicitly submits.
      if (event.target instanceof HTMLTextAreaElement && !(event.metaKey || event.ctrlKey)) {
        return
      }
      event.preventDefault()
      submit(selectedIndex, freeText)
      return
    }

    if (/^[1-9]$/.test(event.key)) {
      const index = Number.parseInt(event.key, 10) - 1
      if (index < 0 || index > lastIndex) return
      event.preventDefault()
      setSelectedIndex(index)

      const picksFreeTextOption = allowFreeText && index === lastIndex
      if (!picksFreeTextOption) {
        submit(index, freeText)
      }
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      maxWidth={480}
    >
      <div
        ref={contentRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="outline-none"
      >
        <ol className="flex flex-col gap-1.5" role="listbox" aria-label={title}>
          {options.map((option, index) => {
            const selected = index === selectedIndex
            const isLast = index === lastIndex
            return (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setSelectedIndex(index)
                    if (!(allowFreeText && index === lastIndex)) {
                      submit(index, freeText)
                    }
                  }}
                  className={cx(
                    'group flex w-full items-center gap-3 rounded-card px-3 py-2.5 text-left',
                    'transition-colors',
                    selected
                      ? 'bg-bubble-user text-primary'
                      : 'bg-transparent text-secondary hover:bg-white/5 hover:text-primary',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-pill text-[11px] font-mono',
                      selected ? 'bg-white/10 text-primary' : 'bg-white/5 text-secondary',
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="flex-1 text-[13px] leading-snug">{option.label}</span>
                  {selected ? (
                    <span className="font-mono text-[11px] text-muted" aria-hidden="true">
                      ↑↓
                    </span>
                  ) : isLast ? (
                    <span className="font-mono text-[11px] text-muted" aria-hidden="true">
                      Dismiss ESC
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ol>

        {showFreeText ? (
          <textarea
            ref={textareaRef}
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            placeholder="What would you like to change?"
            className={cx(
              'mt-3 w-full min-h-[88px] resize-y rounded-card border border-hairline',
              'bg-bubble-user px-3 py-2 text-[13px] text-primary placeholder:text-muted',
              'outline-none focus:border-accent-primary/60',
            )}
          />
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] text-muted">Dismiss ESC</span>
          <Button
            variant="primary"
            size="sm"
            disabled={submitDisabled}
            onClick={() => submit(selectedIndex, freeText)}
            trailingIcon={
              <span className="font-mono text-[11px] opacity-80" aria-hidden="true">
                ↵
              </span>
            }
          >
            Submit
          </Button>
        </div>
      </div>
    </Modal>
  )
}
