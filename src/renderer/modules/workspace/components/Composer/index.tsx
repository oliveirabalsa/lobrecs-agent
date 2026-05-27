import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type {
  AgentId,
  AgentApprovalMode,
  AgentProfile,
  AgentThinkingLevel,
  ImageAttachment,
  Project,
  RoutingDecision,
  SessionStatus,
  SupportedAgentId,
} from '../../../../../shared/types'
import { Spinner } from '../../../../components/ui'
import { AttachmentStrip } from './AttachmentStrip'
import { BackgroundWaitNotice } from './BackgroundWaitNotice'
import { ModelChip } from './ModelChip'
import { SendButton } from './SendButton'
import { SlashMentionPalette } from './SlashMentionPalette'
import { StatusFooter } from './StatusFooter'
import { useComposerState } from './useComposerState'
import { AGENT_SHORT, formatModelLabel } from './modelDisplay'
import { shouldResetPlanModeAfterDispatch } from './planMode'
import {
  extractSlashMentionTokens,
  extensionToSlashMentionOption,
  findActiveSlashMentionTrigger,
  insertSlashMention,
  SLASH_MENTION_CATEGORIES,
  slashMentionKindLabel,
  type SlashMentionOption,
} from './slashMentions'
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
  approvalMode?: AgentApprovalMode
  profileId?: string
  thinking?: AgentThinkingLevel
  planMode?: boolean
}

export interface ComposerProps {
  project: Project
  /** When provided, dispatch reuses the thread instead of creating one. */
  activeThreadId?: string | null
  /** True when an active session is currently running or awaiting approval. */
  busy?: boolean
  /** Optional reason string shown in the status row when busy. */
  busyReason?: string
  /** Optional non-blocking status surfaced above the input. */
  backgroundNotice?: { message: string } | null
  /** Pre-populate the textarea (e.g., after forking a session). */
  prefillPrompt?: string
  /** Monotonic signal that reapplies `prefillPrompt`, even if the text matches. */
  prefillPromptRevision?: number
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
  onOpenSwarm?: () => void
  onSessionStarted: (session: ComposerStartedSession) => void
  /**
   * When provided, submitting while `busy` queues the message instead of
   * blocking. The handler resolves once main has accepted the queued message.
   */
  onEnqueue?: (
    prompt: string,
    agentId?: AgentId,
    modelOverride?: string,
    approvalMode?: AgentApprovalMode,
    profileId?: string,
    thinking?: AgentThinkingLevel,
  ) => void | Promise<void>
  /** Starts the draft as a background child agent on the active thread. */
  onDelegateTask?: (
    goal: string,
    options?: {
      approvalMode?: AgentApprovalMode
      thinking?: AgentThinkingLevel
    },
  ) => void | Promise<void>
}

const MIN_TEXTAREA_HEIGHT = 36
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
  backgroundNotice = null,
  prefillPrompt,
  prefillPromptRevision,
  activeSessionId,
  activeSessionStatus,
  onCancelSession,
  contextPercent = null,
  worktreeBranch = null,
  hasProjectContext = false,
  onContextClick,
  onOpenSwarm,
  onSessionStarted,
  onEnqueue,
  onDelegateTask,
}: ComposerProps) {
  const state = useComposerState({
    projectId: project.id,
    prefillPrompt,
    prefillPromptRevision,
  })
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
    planMode,
    setPlanMode,
    modelSelection,
    setModelSelection,
    modelGroups,
    manualOption,
    routerPreview,
    error,
    setError,
  } = state

  const [submitting, setSubmitting] = useState(false)
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [profileIssues, setProfileIssues] = useState(0)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [submitPhase, setSubmitPhase] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [slashOptions, setSlashOptions] = useState<SlashMentionOption[]>([])
  const [slashLoading, setSlashLoading] = useState(false)
  const [slashError, setSlashError] = useState<string | null>(null)
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const [dismissedSlashKey, setDismissedSlashKey] = useState<string | null>(null)
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
    let cancelled = false
    window.agentforge.agent
      .listProfiles(project.id)
      .then((result) => {
        if (cancelled) return
        setProfiles(result.profiles)
        setProfileIssues(result.issues.length)
        if (selectedProfileId && !result.profiles.some((profile) => profile.id === selectedProfileId)) {
          setSelectedProfileId('')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProfiles([])
          setProfileIssues(0)
        }
      })
    return () => {
      cancelled = true
    }
  }, [project.id, selectedProfileId])

  useEffect(() => {
    if (prefillPrompt === undefined) return
    window.requestAnimationFrame(() => autosizeTextarea(textareaRef.current))
  }, [prefillPrompt, prefillPromptRevision])

  const slashTrigger = useMemo(
    () => findActiveSlashMentionTrigger(draft, cursorPosition),
    [cursorPosition, draft],
  )
  const slashTriggerKey = slashTrigger
    ? `${slashTrigger.start}:${slashTrigger.query}`
    : null
  const slashPickerVisible =
    slashTrigger !== null && slashTriggerKey !== dismissedSlashKey
  const selectedSlashMentions = useMemo(
    () => extractSlashMentionTokens(draft),
    [draft],
  )

  useEffect(() => {
    if (!slashTrigger) {
      setSlashOptions([])
      setSlashLoading(false)
      setSlashError(null)
      setSlashActiveIndex(0)
      return
    }

    let cancelled = false
    setSlashLoading(true)
    setSlashError(null)

    window.agentforge.extensions
      .searchCatalog({
        query: slashTrigger.query,
        categories: SLASH_MENTION_CATEGORIES,
        limit: 8,
      })
      .then((result) => {
        if (cancelled) return
        setSlashOptions(
          result.items
            .map(extensionToSlashMentionOption)
            .filter((option): option is SlashMentionOption => option !== null),
        )
        setSlashActiveIndex(0)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setSlashOptions([])
        setSlashError(
          reason instanceof Error ? reason.message : 'Failed to search context.',
        )
      })
      .finally(() => {
        if (!cancelled) setSlashLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [slashTrigger?.query, slashTrigger?.start])

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

    if (busy) {
      if (!onEnqueue) return
      setSubmitting(true)
      setSubmitPhase('Queueing message')
      setError(null)
      try {
        await onEnqueue(
          effectivePrompt,
          manualOption?.agentId,
          manualOption?.modelId,
          approvalMode,
          selectedProfileId || undefined,
          modelSelection.thinking,
        )
        setDraft('')
        clearAttachments()
        window.requestAnimationFrame(() => autosizeTextarea(textareaRef.current))
      } catch (enqueueError: unknown) {
        setError(
          enqueueError instanceof Error ? enqueueError.message : 'Failed to queue message',
        )
      } finally {
        setSubmitting(false)
        setSubmitPhase(null)
      }
      return
    }

    setSubmitting(true)
    setSubmitPhase(null)
    setError(null)
    const startedAt = Date.now()
    const sentAttachments = attachments.map((image) => image.attachment)
    const resetPlanMode = shouldResetPlanModeAfterDispatch(planMode)

    try {
      const result = await window.agentforge.agent.dispatch({
        projectId: project.id,
        prompt: effectivePrompt,
        profileId: selectedProfileId || undefined,
        agentId: manualOption?.agentId,
        modelOverride: manualOption?.modelId,
        approvalMode,
        thinking: modelSelection.thinking,
        imageAttachments: sentAttachments,
        threadId: activeThreadId ?? undefined,
        planMode: planMode || undefined,
      })
      onSessionStarted({
        sessionId: result.sessionId,
        threadId: result.threadId,
        prompt: effectivePrompt,
        imageAttachments: sentAttachments,
        routingDecision: manualOption ? null : routerPreview,
        agentId: manualOption?.agentId,
        modelOverride: manualOption?.modelId,
        approvalMode,
        thinking: modelSelection.thinking,
        planMode,
        createdAt: startedAt,
      })
      setDraft('')
      clearAttachments()
      if (resetPlanMode) setPlanMode(false)
      window.requestAnimationFrame(() => autosizeTextarea(textareaRef.current))
    } catch (dispatchError: unknown) {
      setError(
        dispatchError instanceof Error ? dispatchError.message : 'Failed to start session',
      )
    } finally {
      setSubmitting(false)
      setSubmitPhase(null)
    }
  }, [
    activeThreadId,
    attachments,
    attaching,
    approvalMode,
    busy,
    clearAttachments,
    draft,
    manualOption,
    modelSelection.thinking,
    onEnqueue,
    onSessionStarted,
    planMode,
    project.id,
    routerPreview,
    selectedProfileId,
    setDraft,
    setError,
    setPlanMode,
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

  const handleMultitask = useCallback(async () => {
    const effectivePrompt = draft.trim()
    if (!effectivePrompt || submitting) return

    setSubmitting(true)
    setError(null)
    const startedAt = Date.now()
    const sentAttachments = attachments.map((a) => a.attachment)

    try {
      const result = await window.agentforge.multitask.decompose({
        projectId: project.id,
        prompt: effectivePrompt,
        threadId: activeThreadId ?? undefined,
        imageAttachments: sentAttachments,
      })

      onSessionStarted({
        sessionId: result.sessionId,
        threadId: result.threadId,
        prompt: effectivePrompt,
        imageAttachments: sentAttachments,
        routingDecision: null,
        createdAt: startedAt,
      })

      setDraft('')
      clearAttachments()
      window.requestAnimationFrame(() => autosizeTextarea(textareaRef.current))
    } catch (multitaskError: unknown) {
      setError(
        multitaskError instanceof Error ? multitaskError.message : 'Failed to decompose tasks',
      )
    } finally {
      setSubmitting(false)
    }
  }, [activeThreadId, attachments, clearAttachments, draft, onSessionStarted, project.id, setDraft, setError, submitting])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void submit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const isComposing = Boolean((event.nativeEvent as { isComposing?: boolean }).isComposing)
    if (slashPickerVisible) {
      if (event.key === 'ArrowDown' && slashOptions.length > 0) {
        event.preventDefault()
        setSlashActiveIndex((index) => Math.min(index + 1, slashOptions.length - 1))
        return
      }
      if (event.key === 'ArrowUp' && slashOptions.length > 0) {
        event.preventDefault()
        setSlashActiveIndex((index) => Math.max(index - 1, 0))
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && slashOptions[slashActiveIndex]) {
        event.preventDefault()
        selectSlashMention(slashOptions[slashActiveIndex])
        return
      }
      if (event.key === 'Escape' && slashTriggerKey) {
        event.preventDefault()
        setDismissedSlashKey(slashTriggerKey)
        return
      }
    }
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

  function handleTextareaChange(value: string, selectionStart: number | null) {
    setDraft(value)
    setCursorPosition(selectionStart ?? value.length)
  }

  function syncCursorPosition() {
    const textarea = textareaRef.current
    if (!textarea) return
    setCursorPosition(textarea.selectionStart ?? draft.length)
  }

  function selectSlashMention(option: SlashMentionOption) {
    if (!slashTrigger) return
    const next = insertSlashMention(draft, slashTrigger, option)
    setDraft(next.value)
    setCursorPosition(next.cursorPosition)
    setDismissedSlashKey(null)
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(next.cursorPosition, next.cursorPosition)
      autosizeTextarea(textarea)
    })
  }

  function selectProfile(profileId: string) {
    setSelectedProfileId(profileId)
    const profile = profiles.find((item) => item.id === profileId)
    if (!profile) return

    if (profile.defaultAgentId && profile.defaultModel) {
      setModelSelection({
        kind: 'manual',
        agentId: profile.defaultAgentId,
        modelId: profile.defaultModel,
        thinking: profile.thinking,
      })
    } else if (profile.thinking) {
      setModelSelection(
        modelSelection.kind === 'manual'
          ? { ...modelSelection, thinking: profile.thinking }
          : { kind: 'auto', thinking: profile.thinking },
      )
    }
    if (profile.approvalMode) setApprovalMode(profile.approvalMode)
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

  const hasContent = draft.trim().length > 0 || attachments.length > 0
  const queueAllowed = busy && !awaitingInput && Boolean(onEnqueue)
  const canSend = hasContent && !attaching && (!busy || queueAllowed)
  const showRouterPreview = modelSelection.kind === 'auto' && draft.trim().length > 0
  const inputBlocked = busy && !queueAllowed
  const placeholder = awaitingInput
    ? 'Respond to the pending agent request above'
    : inputBlocked && busyReason
      ? busyReason
    : queueAllowed
      ? 'Queue a follow-up message…'
      : activeThreadId
        ? 'Ask for follow-up changes'
        : 'Describe the coding task…'
  const submitLabel = !hasContent
    ? undefined
    : queueAllowed
      ? 'Queue message'
      : undefined

  const wrapperBorderClass = 'border-hairline focus-within:border-white/15'
  const wrapperGlowClass = ''

  return (
    <form onSubmit={handleSubmit} className="w-full pb-1 pt-2">
      {backgroundNotice ? (
        <div className="mb-3">
          <BackgroundWaitNotice message={backgroundNotice.message} />
        </div>
      ) : null}

      <div className="relative w-full max-w-conversation mx-auto">
        <div
          className={`flex items-end gap-2 rounded-[24px] border bg-card-raised/60 p-2 shadow-elevated transition-colors ${wrapperBorderClass} ${wrapperGlowClass}`}
        >
          <PlusMenu
            remainingSlots={MAX_ATTACHMENTS - attachments.length}
            disabled={submitting}
            onFilesSelected={(files) => void attachImageFiles(files)}
            profiles={profiles}
            profileIssues={profileIssues}
            selectedProfileId={selectedProfileId}
            onProfileChange={selectProfile}
            approvalMode={approvalMode}
            onApprovalModeChange={setApprovalMode}
            planMode={planMode}
            onTogglePlan={() => setPlanMode(!planMode)}
            onMultitask={() => void handleMultitask()}
            multitaskDisabled={!draft.trim() || submitting || attaching}
            onOpenSwarm={onOpenSwarm}
            busyReason={busyReason}
            queueAllowed={queueAllowed}
            submitPhase={submitPhase}
          />

          <div className="flex-1 min-w-0 flex flex-col justify-end">
            <AttachmentStrip
              attachments={attachments}
              attaching={attaching}
              onRemove={removeAttachment}
            />

            {selectedSlashMentions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pb-1 px-1">
                {selectedSlashMentions.map((mention) => (
                  <span
                    key={`${mention.kind}:${mention.value}:${mention.raw}`}
                    className="inline-flex max-w-full items-center gap-1 rounded-pill border border-accent-primary/25 bg-accent-primary/10 px-2 py-0.5 text-[11px] text-accent-primary"
                    title={mention.raw}
                  >
                    <span className="shrink-0 uppercase">
                      {slashMentionKindLabel(mention.kind)}
                    </span>
                    <span className="min-w-0 truncate font-mono">{mention.value}</span>
                  </span>
                ))}
              </div>
            ) : null}

            {showRouterPreview ? (
              <div className="px-1 pb-1 text-[10px] text-muted truncate" aria-live="polite">
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

            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) =>
                handleTextareaChange(event.target.value, event.target.selectionStart)
              }
              onKeyDown={handleKeyDown}
              onKeyUp={syncCursorPosition}
              onClick={syncCursorPosition}
              onSelect={syncCursorPosition}
              onPaste={(event) => void handlePaste(event)}
              className="block w-full resize-none bg-transparent px-2 py-1.5 text-[14px] leading-5 text-primary outline-none placeholder:text-muted/60"
              style={{ minHeight: MIN_TEXTAREA_HEIGHT, maxHeight: MAX_TEXTAREA_HEIGHT }}
              placeholder={placeholder}
              disabled={submitting || attaching || inputBlocked}
              aria-label="Message composer"
            />
          </div>

          <div className="flex min-w-0 shrink-0 items-center gap-1.5 pr-1 pb-0.5">
            {submitting || running ? (
              <span className="inline-flex h-6 w-6 items-center justify-center text-muted">
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
            <MicButton />
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

        {slashPickerVisible ? (
          <div className="absolute bottom-full left-0 z-50 w-full mb-2">
            <SlashMentionPalette
              options={slashOptions}
              loading={slashLoading}
              error={slashError}
              activeIndex={slashActiveIndex}
              onHover={setSlashActiveIndex}
              onSelect={selectSlashMention}
            />
          </div>
        ) : null}
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

interface PlusMenuProps {
  remainingSlots: number
  disabled?: boolean
  onFilesSelected: (files: File[]) => void
  profiles: AgentProfile[]
  profileIssues: number
  selectedProfileId: string
  onProfileChange: (profileId: string) => void
  approvalMode: AgentApprovalMode
  onApprovalModeChange: (mode: AgentApprovalMode) => void
  planMode: boolean
  onTogglePlan: () => void
  onMultitask: () => void
  multitaskDisabled: boolean
  onOpenSwarm?: () => void
  busyReason?: string
  queueAllowed?: boolean
  submitPhase?: string | null
}

function PlusMenu({
  remainingSlots,
  disabled = false,
  onFilesSelected,
  profiles,
  profileIssues,
  selectedProfileId,
  onProfileChange,
  approvalMode,
  onApprovalModeChange,
  planMode,
  onTogglePlan,
  onMultitask,
  multitaskDisabled,
  onOpenSwarm,
  busyReason,
  queueAllowed,
  submitPhase,
}: PlusMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  function handleAttachClick() {
    if (disabled || remainingSlots <= 0) return
    fileInputRef.current?.click()
    setOpen(false)
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) =>
      file.type.startsWith('image/'),
    )
    if (files.length > 0) {
      onFilesSelected(files.slice(0, remainingSlots))
    }
    event.target.value = ''
  }

  return (
    <div ref={menuRef} className="relative shrink-0 select-none">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-label="Plus actions"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-muted hover:bg-white/10 hover:text-primary transition-colors focus:outline-none disabled:opacity-40"
      >
        <PlusIcon />
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        tabIndex={-1}
      />

      {open && (
        <div className="absolute bottom-full left-0 z-[60] mb-2 w-64 overflow-hidden rounded-card border border-hairline bg-card-raised py-1.5 shadow-xl shadow-black/40">
          <button
            type="button"
            disabled={remainingSlots <= 0}
            onClick={handleAttachClick}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-secondary hover:bg-white/5 hover:text-primary disabled:opacity-40"
          >
            <span aria-hidden="true" className="text-sm font-semibold">+</span>
            <span>Attach images ({remainingSlots} left)</span>
          </button>

          <div className="my-1 border-t border-hairline" />

          <div className="px-3 py-1 text-[10px] font-semibold uppercase text-muted">Execution Mode</div>
          <button
            type="button"
            onClick={() => {
              if (planMode) onTogglePlan()
              setOpen(false)
            }}
            className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${
              !planMode ? 'text-accent-primary bg-white/5 font-semibold' : 'text-secondary hover:bg-white/5 hover:text-primary'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <SendIcon size={11} />
              Execute immediately
            </span>
            {!planMode && <span>✓</span>}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!planMode) onTogglePlan()
              setOpen(false)
            }}
            className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${
              planMode ? 'text-accent-primary bg-white/5 font-semibold' : 'text-secondary hover:bg-white/5 hover:text-primary'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <PlanModeIcon />
              Plan first, then execute
            </span>
            {planMode && <span>✓</span>}
          </button>
          <button
            type="button"
            disabled={multitaskDisabled}
            onClick={() => {
              setOpen(false)
              onMultitask()
            }}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-secondary hover:bg-white/5 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <MultitaskIcon />
            Decompose into parallel tasks
          </button>

          <div className="my-1 border-t border-hairline" />

          <div className="px-3 py-1 text-[10px] font-semibold uppercase text-muted">Approval posture</div>
          {(['manual', 'auto-safe', 'full'] as const).map((mode) => {
            const meta = {
              full: { label: 'Full access', icon: '⊘' },
              'auto-safe': { label: 'Auto-approve safe', icon: '✓' },
              manual: { label: 'Manual approve', icon: '⊙' },
            }[mode]
            const active = approvalMode === mode
            return (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  onApprovalModeChange(mode)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${
                  active ? 'text-accent-primary bg-white/5 font-semibold' : 'text-secondary hover:bg-white/5 hover:text-primary'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="inline-flex h-3.5 w-3.5 items-center justify-center text-[11px]">{meta.icon}</span>
                  {meta.label}
                </span>
                {active && <span>✓</span>}
              </button>
            )
          })}

          {profiles.length > 0 && (
            <>
              <div className="my-1 border-t border-hairline" />
              <div className="px-3 py-1 text-[10px] font-semibold uppercase text-muted">Agent Profile</div>
              <div className="px-3 py-1">
                <select
                  value={selectedProfileId}
                  onChange={(e) => {
                    onProfileChange(e.target.value)
                    setOpen(false)
                  }}
                  className="w-full rounded border border-hairline bg-card-raised px-2 py-1 text-xs text-secondary outline-none focus:border-accent-primary"
                >
                  <option value="">Profile: none</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {onOpenSwarm && (
            <>
              <div className="my-1 border-t border-hairline" />
              <button
                type="button"
                onClick={() => {
                  onOpenSwarm()
                  setOpen(false)
                }}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-secondary hover:bg-white/5 hover:text-primary"
              >
                <BeeIcon />
                <span>Open Swarm Builder</span>
              </button>
            </>
          )}

          {(busyReason || submitPhase) && (
            <>
              <div className="my-1 border-t border-hairline" />
              <div className="px-3 py-1 text-[10px] text-muted">
                {busyReason && !queueAllowed ? busyReason : null}
                {submitPhase ? `${submitPhase}...` : null}
              </div>
            </>
          )}
        </div>
      )}
    </div>
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
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
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

function MicButton() {
  return (
    <button
      type="button"
      disabled
      title="Voice input (Not available)"
      className="flex h-7 w-7 items-center justify-center rounded-full text-muted/50 cursor-not-allowed hover:bg-transparent"
    >
      <MicIcon />
    </button>
  )
}

/** Checklist-with-tick glyph for the composer's plan-mode toggle. */
function PlanModeIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6h10" />
      <path d="M4 12h10" />
      <path d="M4 18h7" />
      <path d="m15 16 2 2 4-4" />
    </svg>
  )
}

function BeeIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7.5 8.5c-1.8-1.4-3.5-1.6-4.6-.5-.9.9-.5 2.5.9 3.5 1.1.8 2.5 1 3.8.6" />
      <path d="M16.5 8.5c1.8-1.4 3.5-1.6 4.6-.5.9.9.5 2.5-.9 3.5-1.1.8-2.5 1-3.8.6" />
      <path d="M8 9.5c.8-1.4 2.2-2.2 4-2.2s3.2.8 4 2.2c.9 1.5.9 4.1 0 5.6-.8 1.4-2.2 2.2-4 2.2s-3.2-.8-4-2.2c-.9-1.5-.9-4.1 0-5.6Z" />
      <path d="M9 11h6" />
      <path d="M8.8 14h6.4" />
      <path d="M9.5 5.5 8 3.5" />
      <path d="m14.5 5.5 1.5-2" />
      <path d="M11 18.5 9.5 21" />
      <path d="m13 18.5 1.5 2.5" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  )
}

function SendIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

function MultitaskIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
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
