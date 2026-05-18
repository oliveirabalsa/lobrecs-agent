import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import type {
  Project,
  RoutingDecision,
  SessionStatus,
  SupportedAgentId,
} from '../../../../../shared/types'
import { Button, Spinner } from '../../../../components/ui'
import { ApprovalModeChip } from './ApprovalModeChip'
import { AttachButton } from './AttachButton'
import { AttachmentStrip } from './AttachmentStrip'
import { ModelChip } from './ModelChip'
import { SendButton } from './SendButton'
import { StatusFooter } from './StatusFooter'
import { useComposerState } from './useComposerState'
import type { AttachedImage } from './types'

/** Mirrors the `StartedSessionSummary` shape consumed by the workspace controller. */
export interface ComposerStartedSession {
  sessionId: string
  threadId: string
  prompt: string
  createdAt: number
  routingDecision: RoutingDecision | null
  agentId?: SupportedAgentId
  modelOverride?: string
}

export interface ComposerProps {
  project: Project
  /** When provided, dispatch reuses the thread instead of creating one. */
  activeThreadId?: string | null
  /** True when an active session is currently running or awaiting approval. */
  busy?: boolean
  /** Optional reason string shown in the status row when busy. */
  busyReason?: string
  /** Pre-populate the textarea (e.g., after forking a session). */
  prefillPrompt?: string
  /** Active session id — used to enable the Stop action. */
  activeSessionId?: string | null
  /** Active session status — distinguishes a stoppable run from other busy gates. */
  activeSessionStatus?: SessionStatus | null
  /** Cancels the active session through the workspace controller. */
  onCancelSession?: (sessionId: string) => void | Promise<void>
  /** Optional context-window percent for the footer. */
  contextPercent?: number | null
  /** Optional worktree branch label for the footer. */
  worktreeBranch?: string | null
  onSessionStarted: (session: ComposerStartedSession) => void
}

const MIN_TEXTAREA_HEIGHT = 56
const MAX_TEXTAREA_HEIGHT = 240
const MAX_ATTACHMENTS = 8

function autosizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return
  textarea.style.height = '0px'
  const next = Math.min(
    Math.max(textarea.scrollHeight, MIN_TEXTAREA_HEIGHT),
    MAX_TEXTAREA_HEIGHT,
  )
  textarea.style.height = `${next}px`
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to read image'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read image'))
    reader.readAsDataURL(file)
  })
}

/**
 * Codex-shaped composer: a rounded card with textarea, attachment strip,
 * optional router-preview line, and a two-row footer (attach + approval mode
 * left; spinner + model chip + mic + send right). A 22px status row with
 * `Local | N% context` sits below the card.
 */
export function Composer({
  project,
  activeThreadId,
  busy = false,
  busyReason,
  prefillPrompt,
  activeSessionId,
  activeSessionStatus,
  onCancelSession,
  contextPercent = null,
  worktreeBranch = null,
  onSessionStarted,
}: ComposerProps) {
  const state = useComposerState({ projectId: project.id, prefillPrompt })
  const {
    draft,
    setDraft,
    attachments,
    addAttachments,
    removeAttachment,
    clearAttachments,
    attaching,
    setAttaching,
    approvalMode,
    setApprovalMode,
    modelSelection,
    setModelSelection,
    modelGroups,
    manualOption,
    routerPreview,
    error,
    setError,
  } = state

  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    autosizeTextarea(textareaRef.current)
  }, [draft])

  useEffect(() => {
    if (prefillPrompt === undefined) return
    window.requestAnimationFrame(() => autosizeTextarea(textareaRef.current))
  }, [prefillPrompt])

  const submit = useCallback(async () => {
    const trimmed = draft.trim()
    const effectivePrompt =
      trimmed || (attachments.length > 0 ? 'Use the attached image as context.' : '')
    if (!effectivePrompt || submitting || busy || attaching) return

    setSubmitting(true)
    setError(null)
    const startedAt = Date.now()

    try {
      const result = await window.agentforge.agent.dispatch({
        projectId: project.id,
        prompt: effectivePrompt,
        agentId: manualOption?.agentId,
        modelOverride: manualOption?.modelId,
        imageAttachments: attachments.map((image) => image.attachment),
        threadId: activeThreadId ?? undefined,
      })
      onSessionStarted({
        sessionId: result.sessionId,
        threadId: result.threadId,
        prompt: effectivePrompt,
        routingDecision: manualOption ? null : routerPreview,
        agentId: manualOption?.agentId,
        modelOverride: manualOption?.modelId,
        createdAt: startedAt,
      })
      setDraft('')
      clearAttachments()
      window.requestAnimationFrame(() => autosizeTextarea(textareaRef.current))
    } catch (dispatchError: unknown) {
      setError(
        dispatchError instanceof Error ? dispatchError.message : 'Failed to start session',
      )
    } finally {
      setSubmitting(false)
    }
  }, [
    activeThreadId,
    attachments,
    attaching,
    busy,
    clearAttachments,
    draft,
    manualOption,
    onSessionStarted,
    project.id,
    routerPreview,
    setDraft,
    setError,
    submitting,
  ])

  const handleStop = useCallback(async () => {
    if (!activeSessionId) return
    try {
      if (onCancelSession) {
        await onCancelSession(activeSessionId)
      } else {
        await window.agentforge.agent.cancel(activeSessionId)
      }
    } catch (cancelError: unknown) {
      setError(cancelError instanceof Error ? cancelError.message : 'Failed to cancel session')
    }
  }, [activeSessionId, onCancelSession, setError])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void submit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void submit()
      return
    }
    if (event.key === 'Escape' && draft.length > 0) {
      event.preventDefault()
      setDraft('')
    }
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = [...event.clipboardData.items]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))

    if (imageFiles.length === 0) return

    event.preventDefault()
    await attachImageFiles(imageFiles)
  }

  async function attachImageFiles(files: File[]) {
    if (files.length === 0) return
    const remaining = MAX_ATTACHMENTS - attachments.length
    if (remaining <= 0) return
    const accepted = files.slice(0, remaining)

    setAttaching(true)
    setError(null)
    try {
      const saved: AttachedImage[] = await Promise.all(
        accepted.map(async (file) => {
          const dataUrl = await readFileAsDataUrl(file)
          const attachment = await window.agentforge.system.saveImageAttachment({
            dataUrl,
            name: file.name || `clipboard-${Date.now()}.png`,
            mimeType: file.type,
          })
          return {
            id: `${attachment.filePath}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            previewUrl: URL.createObjectURL(file),
            attachment,
          }
        }),
      )
      addAttachments(saved)
    } catch (attachError: unknown) {
      setError(attachError instanceof Error ? attachError.message : 'Failed to attach image')
    } finally {
      setAttaching(false)
    }
  }

  const running =
    Boolean(activeSessionId) &&
    (activeSessionStatus === 'running' || activeSessionStatus === 'awaiting-approval')
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !attaching && !busy
  const showRouterPreview = modelSelection.kind === 'auto' && draft.trim().length > 0
  const placeholder = activeThreadId ? 'Ask for follow-up changes' : 'Describe the coding task…'

  return (
    <form onSubmit={handleSubmit} className="w-full pb-1 pt-2">
      <div className="rounded-bubble border border-hairline bg-card focus-within:border-white/15">
        <AttachmentStrip
          attachments={attachments}
          attaching={attaching}
          onRemove={removeAttachment}
        />

        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(event) => void handlePaste(event)}
          className="block w-full resize-none bg-transparent px-3 pb-2 pt-3 text-sm leading-6 text-primary outline-none placeholder:text-muted"
          style={{ minHeight: MIN_TEXTAREA_HEIGHT, maxHeight: MAX_TEXTAREA_HEIGHT }}
          placeholder={placeholder}
          disabled={submitting || attaching}
          aria-label="Message composer"
        />

        {showRouterPreview ? (
          <div className="px-3 pb-1 text-xs text-muted" aria-live="polite">
            {routerPreview ? (
              <>
                → {routerPreview.agentId} · {routerPreview.model} · score{' '}
                {routerPreview.score.toFixed(2)} · {routerPreview.reasoning}
              </>
            ) : (
              <>→ resolving route…</>
            )}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <AttachButton
              remainingSlots={MAX_ATTACHMENTS - attachments.length}
              disabled={submitting}
              onFilesSelected={(files) => void attachImageFiles(files)}
            />
            <ApprovalModeChip mode={approvalMode} onChange={setApprovalMode} />
            {busyReason ? (
              <span className="min-w-0 truncate text-[11px] text-muted">{busyReason}</span>
            ) : null}
          </div>

          <div className="flex min-w-0 shrink-0 items-center gap-1.5">
            {submitting || running ? (
              <span className="inline-flex h-7 w-7 items-center justify-center text-muted">
                <Spinner size={12} />
              </span>
            ) : null}
            <ModelChip
              groups={modelGroups}
              selection={modelSelection}
              manualOption={manualOption}
              routerPreview={routerPreview}
              onSelect={setModelSelection}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label="Voice input (coming soon)"
              disabled
              leadingIcon={<MicIcon />}
              // Tooltip via title attribute — Radix tooltip skipped for now.
              onClick={() => {
                /* no-op until voice input ships */
              }}
              className="cursor-not-allowed"
            />
            <span title="Coming soon" className="sr-only">
              Voice input coming soon
            </span>
            <SendButton
              running={running}
              canSend={canSend}
              loading={submitting}
              onSend={() => void submit()}
              onStop={activeSessionId ? () => void handleStop() : undefined}
            />
          </div>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-2 rounded-card border border-accent-del/40 bg-accent-del/10 px-3 py-2 text-xs text-accent-del"
        >
          {error}
        </div>
      ) : null}

      <StatusFooter worktreeBranch={worktreeBranch} contextPercent={contextPercent} />
    </form>
  )
}

function MicIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  )
}
