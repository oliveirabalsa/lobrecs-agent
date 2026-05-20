import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type {
  AgentId,
  ImageAttachment,
  Project,
  RoutingDecision,
  SessionStatus,
  SupportedAgentId,
} from '../../../../../shared/types'
import { Spinner } from '../../../../components/ui'
import { AttachButton } from './AttachButton'
import { AttachmentStrip } from './AttachmentStrip'
import { ModelChip } from './ModelChip'
import { SendButton } from './SendButton'
import { StatusFooter } from './StatusFooter'
import { useComposerState } from './useComposerState'
import { AGENT_SHORT, formatModelLabel } from './modelDisplay'
import type { AttachedImage } from './types'

/** Mirrors the `StartedSessionSummary` shape consumed by the workspace controller. */
export interface ComposerStartedSession {
  sessionId: string
  threadId: string
  prompt: string
  imageAttachments?: ImageAttachment[]
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
  hasProjectContext?: boolean
  onContextClick?: () => void
  onSessionStarted: (session: ComposerStartedSession) => void
  /**
   * When provided, submitting while `busy` queues the message instead of
   * blocking. The handler resolves once main has accepted the queued message.
   */
  onEnqueue?: (
    prompt: string,
    agentId?: AgentId,
    modelOverride?: string,
  ) => void | Promise<void>
  /**
   * When provided, the composer shows a Steer toggle while a session is
   * running. Activating it and submitting cancels the active session and
   * redirects the agent with the new prompt on the same thread.
   */
  onSteer?: (prompt: string) => void | Promise<void>
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
  hasProjectContext = false,
  onContextClick,
  onSessionStarted,
  onEnqueue,
  onSteer,
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
    modelSelection,
    setModelSelection,
    modelGroups,
    manualOption,
    routerPreview,
    error,
    setError,
  } = state

  const [submitting, setSubmitting] = useState(false)
  const [steerMode, setSteerMode] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const attachingRef = useRef(false)
  // Counts dragenter minus dragleave. Native drag events fire leave+enter on
  // every child-boundary crossing, so a raw boolean would flicker — the depth
  // counter only drops the overlay once the pointer truly leaves the window.
  const dragDepthRef = useRef(0)
  // Holds the latest attachImageFiles closure so the window drag listeners,
  // bound once, never need to re-subscribe when the closure is recreated.
  const attachImageFilesRef = useRef<(files: File[]) => Promise<void>>(
    async () => {},
  )

  useEffect(() => {
    autosizeTextarea(textareaRef.current)
  }, [draft])

  useEffect(() => {
    if (prefillPrompt === undefined) return
    window.requestAnimationFrame(() => autosizeTextarea(textareaRef.current))
  }, [prefillPrompt])

  // Focus the composer on mount and whenever the active thread changes, so a
  // freshly-opened chat is immediately typeable.
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || textarea.disabled) return
    textarea.focus()
  }, [activeThreadId])

  // Pasting an image flips `attaching` → textarea becomes `disabled`, which
  // blurs it. Re-focus once the attach finishes and the element is editable
  // again.
  useEffect(() => {
    if (attachingRef.current && !attaching) {
      const textarea = textareaRef.current
      if (textarea && !textarea.disabled) textarea.focus()
    }
    attachingRef.current = attaching
  }, [attaching])

  const submit = useCallback(async () => {
    const trimmed = draft.trim()
    const effectivePrompt =
      trimmed || (attachments.length > 0 ? 'Use the attached image as context.' : '')
    if (!effectivePrompt || submitting || attaching) return

    if (steerMode && onSteer) {
      setSubmitting(true)
      setError(null)
      try {
        await onSteer(effectivePrompt)
        setDraft('')
        clearAttachments()
        setSteerMode(false)
        window.requestAnimationFrame(() => autosizeTextarea(textareaRef.current))
      } catch (steerError: unknown) {
        setError(
          steerError instanceof Error ? steerError.message : 'Failed to steer agent',
        )
      } finally {
        setSubmitting(false)
      }
      return
    }

    if (busy) {
      if (!onEnqueue) return
      setSubmitting(true)
      setError(null)
      try {
        await onEnqueue(effectivePrompt, manualOption?.agentId, manualOption?.modelId)
        setDraft('')
        clearAttachments()
        window.requestAnimationFrame(() => autosizeTextarea(textareaRef.current))
      } catch (enqueueError: unknown) {
        setError(
          enqueueError instanceof Error ? enqueueError.message : 'Failed to queue message',
        )
      } finally {
        setSubmitting(false)
      }
      return
    }

    setSubmitting(true)
    setError(null)
    const startedAt = Date.now()
    const sentAttachments = attachments.map((image) => image.attachment)

    try {
      const result = await window.agentforge.agent.dispatch({
        projectId: project.id,
        prompt: effectivePrompt,
        agentId: manualOption?.agentId,
        modelOverride: manualOption?.modelId,
        imageAttachments: sentAttachments,
        threadId: activeThreadId ?? undefined,
      })
      onSessionStarted({
        sessionId: result.sessionId,
        threadId: result.threadId,
        prompt: effectivePrompt,
        imageAttachments: sentAttachments,
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
    onEnqueue,
    onSessionStarted,
    onSteer,
    project.id,
    routerPreview,
    setDraft,
    setError,
    steerMode,
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
    const isComposing = Boolean((event.nativeEvent as { isComposing?: boolean }).isComposing)
    if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
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

  attachImageFilesRef.current = attachImageFiles

  // Window-level drag-and-drop: dropping image files anywhere over the app
  // attaches them to the composer, with a full-viewport dropzone overlay.
  useEffect(() => {
    function dragHasFiles(event: DragEvent): boolean {
      return event.dataTransfer?.types.includes('Files') ?? false
    }
    function handleDragEnter(event: DragEvent) {
      if (!dragHasFiles(event)) return
      dragDepthRef.current += 1
      setDragActive(true)
    }
    function handleDragOver(event: DragEvent) {
      if (!dragHasFiles(event)) return
      // Required: without preventDefault the browser never fires `drop`.
      event.preventDefault()
    }
    function handleDragLeave(event: DragEvent) {
      if (!dragHasFiles(event)) return
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) setDragActive(false)
    }
    function handleDrop(event: DragEvent) {
      dragDepthRef.current = 0
      setDragActive(false)
      if (!dragHasFiles(event)) return
      // Stop the renderer from navigating to the dropped file.
      event.preventDefault()
      const images = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
        file.type.startsWith('image/'),
      )
      if (images.length > 0) void attachImageFilesRef.current(images)
    }
    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
    }
  }, [])

  const running =
    Boolean(activeSessionId) &&
    (activeSessionStatus === 'running' || activeSessionStatus === 'awaiting-approval')
  const awaitingInput = activeSessionStatus === 'awaiting-input'

  // Drop steer mode automatically when the session is no longer running, so a
  // stale toggle doesn't apply to the next idle composer state.
  useEffect(() => {
    if (!running) setSteerMode(false)
  }, [running])

  const hasContent = draft.trim().length > 0 || attachments.length > 0
  const queueAllowed = busy && !awaitingInput && Boolean(onEnqueue) && !steerMode
  const canSend =
    hasContent && !attaching && (!busy || queueAllowed || (steerMode && Boolean(onSteer)))
  const showRouterPreview = modelSelection.kind === 'auto' && draft.trim().length > 0
  const placeholder = steerMode
    ? 'Redirect the agent…'
    : awaitingInput
      ? 'Answer the agent question above'
      : queueAllowed
        ? 'Queue a follow-up message…'
        : activeThreadId
          ? 'Ask for follow-up changes'
          : 'Describe the coding task…'
  const submitLabel = !hasContent
    ? undefined
    : steerMode
      ? 'Steer agent'
      : queueAllowed
        ? 'Queue message'
        : undefined

  const wrapperBorderClass = steerMode
    ? 'border-accent-warn/50 focus-within:border-accent-warn/70'
    : 'border-hairline focus-within:border-white/15'
  // Soft accent glow breathing behind the bar while the agent runs a turn.
  // Suppressed in steer mode, whose amber border owns the composer's color.
  const wrapperGlowClass = running && !steerMode ? 'animate-composer-pulse' : ''

  return (
    <form onSubmit={handleSubmit} className="w-full pb-1 pt-2">
      <div
        className={`rounded-bubble border bg-card ${wrapperBorderClass} ${wrapperGlowClass}`}
      >
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
                → {AGENT_SHORT[routerPreview.agentId] ?? routerPreview.agentId} ·{' '}
                {formatModelLabel(routerPreview.agentId, routerPreview.model)} · score{' '}
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
            {running && onSteer ? (
              <button
                type="button"
                onClick={() => setSteerMode((current) => !current)}
                aria-pressed={steerMode}
                title={steerMode ? 'Cancel steer mode' : 'Steer agent (redirect mid-run)'}
                className={`flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
                  steerMode
                    ? 'bg-accent-warn/20 text-accent-warn'
                    : 'text-muted hover:bg-white/5 hover:text-secondary'
                }`}
              >
                <span aria-hidden="true">↻</span>
                {steerMode ? 'Steering' : 'Steer'}
              </button>
            ) : null}
            {busyReason && !steerMode && !queueAllowed ? (
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
            <SendButton
              running={running}
              canSend={canSend}
              loading={submitting}
              submitLabel={submitLabel}
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

      <StatusFooter
        worktreeBranch={worktreeBranch}
        contextPercent={contextPercent}
        hasProjectContext={hasProjectContext}
        onContextClick={onContextClick}
      />

      {dragActive ? createPortal(<DropzoneOverlay />, document.body) : null}
    </form>
  )
}

/**
 * Full-viewport dropzone shown while image files are dragged over the app.
 * Rendered into document.body so it floats above every workspace surface
 * regardless of the composer's own stacking context, and kept
 * `pointer-events-none` so it never intercepts the drag — events pass
 * straight through to the window listeners that own the drop.
 */
function DropzoneOverlay() {
  return (
    <div
      className="motion-fade-in pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-canvas/55 backdrop-blur-md"
      aria-hidden="true"
    >
      <div className="absolute inset-3 rounded-bubble border-2 border-dashed border-accent-primary/40" />
      <div className="flex flex-col items-center gap-3 rounded-bubble border border-hairline bg-card-raised/80 px-10 py-8 text-center shadow-2xl shadow-black/50 backdrop-blur-md">
        <span className="text-accent-primary">
          <DropIcon />
        </span>
        <div className="text-sm font-medium text-primary">
          Drop file to attach context
        </div>
        <div className="text-xs text-muted">
          Images are added to your next message
        </div>
      </div>
    </div>
  )
}

function DropIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
    </svg>
  )
}
