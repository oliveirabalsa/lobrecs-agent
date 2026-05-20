import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SUPPORTED_AGENT_IDS } from '../../../../shared/types'
import type {
  ApprovalRequest,
  DiffProposal,
  ImageAttachment,
  Project,
  SessionStatus,
  SupportedAgentId,
  ThreadTranscriptTurn,
} from '../../../../shared/types'
import { AssistantMessage } from '../components/AssistantMessage'
import type { MarkdownLinkRequest } from '../components/MarkdownContent'
import type { MarkdownPreviewDocument } from '../components/MarkdownPreviewer'
import { MessageStream } from '../components/MessageStream'
import { PlanPromptModal } from '../components/modals/PlanPromptModal'
import {
  formatUserQuestionPromptAnswers,
  UserQuestionPromptModal,
  type UserQuestionPromptAnswer,
} from '../components/modals/UserQuestionPromptModal'
import { UserMessage } from '../components/UserMessage'
import { useAttentionSound } from '../hooks/useAttentionSound'
import { useSessionEvents, type UserQuestionActivity } from '../hooks/useSessionEvents'
import type { DiffProposalScope } from '../hooks/useWorkspaceController'
import type { StartedSessionSummary } from '../../sessions/types'
import { Button, Modal } from '../../../components/ui'

interface RunWorkspaceProps {
  project: Project
  sessionId: string | null
  threadId?: string | null
  prompt: string
  imageAttachments?: ImageAttachment[]
  status: SessionStatus | null
  startedAt?: number
  agentId?: Project['agentId']
  model?: string
  modelOverride?: string
  diffProposals: DiffProposal[]
  approvalRequest: ApprovalRequest | null
  onApprovalRequest: (request: ApprovalRequest | null) => void
  onDiffProposals: (proposals: DiffProposal[], source?: DiffProposalScope) => void
  onStatusChange: (status: SessionStatus) => void
  onApproveApproval: () => void | Promise<void>
  onRejectApproval: () => void | Promise<void>
  onSessionStarted?: (session: StartedSessionSummary) => void
  /**
   * Opens the workspace right panel in diff mode, optionally focusing a
   * specific file. Lifted from `WorkspaceView` so per-file "Review" buttons
   * inside `<EditedFilesCard>` jump straight to the matching diff tab.
   */
  onReviewFile?: (filePath?: string) => void
  onOpenMarkdown?: (request: MarkdownLinkRequest) => void
  onPreviewMarkdown?: (document: MarkdownPreviewDocument) => void
  /** Called with the context window percentage (0–100) after a session completes. */
  onContextPercent?: (percent: number | null) => void
}

/**
 * Renders the message-stream column for an active session.
 *
 * M4: the standalone `<DiffSummaryCard>` was removed — diff proposals now
 * surface inline via `<EditedFilesCard>`, which is rendered by the message
 * stream's dispatch table whenever an `edited-files-group` synthetic item
 * appears. The proposals + approve/reject callbacks travel down through
 * `streamHandlers` so the card stays a pure presentation component.
 */
export function RunWorkspace({
  project,
  sessionId,
  threadId,
  prompt,
  imageAttachments,
  status,
  startedAt,
  agentId,
  model,
  modelOverride,
  diffProposals,
  approvalRequest,
  onApprovalRequest,
  onDiffProposals,
  onStatusChange,
  onApproveApproval,
  onRejectApproval,
  onSessionStarted,
  onReviewFile,
  onOpenMarkdown,
  onPreviewMarkdown,
  onContextPercent,
}: RunWorkspaceProps) {
  const handleSessionDiffProposals = useCallback(
    (proposals: DiffProposal[]) => {
      onDiffProposals(proposals, {
        sessionId,
        threadId: threadId ?? null,
      })
    },
    [onDiffProposals, sessionId, threadId],
  )

  const {
    activities,
    activityTimes,
    loading,
    pendingPlanPrompt,
    pendingUserQuestion,
    resolvePlanPrompt,
    resolveUserQuestion,
    tokensIn,
  } = useSessionEvents(sessionId, {
    onApprovalRequest,
    onDiffProposals: handleSessionDiffProposals,
    onStatusChange,
  })

  useEffect(() => {
    if (!onContextPercent) return
    if (tokensIn === null) {
      onContextPercent(null)
      return
    }
    onContextPercent(Math.min(100, Math.round((tokensIn / 200_000) * 100)))
  }, [tokensIn, onContextPercent])
  const [priorTurns, setPriorTurns] = useState<ThreadTranscriptTurn[]>([])
  const [activeUserQuestion, setActiveUserQuestion] = useState<UserQuestionActivity | null>(null)
  const [questionSubmitError, setQuestionSubmitError] = useState<string | null>(null)
  const [submittingQuestion, setSubmittingQuestion] = useState(false)
  const dismissedUserQuestionIdsRef = useRef<Set<string>>(new Set())

  // Audible "agent needs you" alert — chimes on new questions, approvals, and
  // finished runs. Tune *when* it fires in src/renderer/lib/attentionSound.ts.
  useAttentionSound({
    questionPromptId: pendingUserQuestion?.promptId ?? null,
    approvalPending: approvalRequest !== null,
    status,
  })

  useEffect(() => {
    setPriorTurns([])
    if (!threadId) return

    let cancelled = false
    void window.agentforge.sessions
      .listThreadTranscript(threadId, {
        limit: 8,
        excludeSessionId: sessionId ?? undefined,
      })
      .then((turns) => {
        if (!cancelled) setPriorTurns(turns)
      })
      .catch(() => {
        if (!cancelled) setPriorTurns([])
      })

    return () => {
      cancelled = true
    }
  }, [sessionId, threadId])

  // A pending agent question belongs to the *thread*, not one session run.
  // Queued follow-ups, steering, and answering all start a fresh `sessionId`
  // on the same thread; resetting on `sessionId` used to wipe an unanswered
  // question modal mid-flight. Only a real thread switch should clear it.
  const questionThreadKey = threadId ?? sessionId

  useEffect(() => {
    dismissedUserQuestionIdsRef.current = new Set()
    setActiveUserQuestion(null)
    setQuestionSubmitError(null)
  }, [questionThreadKey])

  useEffect(() => {
    if (!pendingUserQuestion || activeUserQuestion) return
    if (dismissedUserQuestionIdsRef.current.has(pendingUserQuestion.promptId)) return

    setActiveUserQuestion(pendingUserQuestion)
    setQuestionSubmitError(null)
  }, [activeUserQuestion, pendingUserQuestion])

  const pendingApprovals = approvalRequest ? 1 : 0
  const pendingQuestions = pendingUserQuestion ? 1 : 0
  const effectiveStatus = status ?? (sessionId ? 'running' : null)
  const seedUserMessage = useMemo(() => {
    if (!prompt) return undefined
    if (startedAt === undefined) {
      return { text: prompt, attachments: imageAttachments }
    }
    return { text: prompt, attachments: imageAttachments, at: startedAt }
  }, [imageAttachments, prompt, startedAt])

  // Forward "Review" clicks from <EditedFilesCard> to the workspace shell so
  // it can open the right-side diff panel and focus the requested file. When
  // no handler is wired (legacy callers / tests), this falls back to a no-op.
  const handleReviewFile = useCallback(
    (filePath?: string) => {
      onReviewFile?.(filePath)
    },
    [onReviewFile],
  )

  const streamHandlers = useMemo(
    () => ({
      diffProposals,
      approvalRequest,
      pendingUserQuestionPromptId: pendingUserQuestion?.promptId ?? null,
      onReviewFile: handleReviewFile,
      onApproveApproval,
      onRejectApproval,
      onAnswerUserQuestion: (prompt: UserQuestionActivity) => {
        dismissedUserQuestionIdsRef.current.delete(prompt.promptId)
        setActiveUserQuestion(prompt)
        setQuestionSubmitError(null)
      },
      onOpenMarkdown,
      onPreviewMarkdown,
    }),
    [
      diffProposals,
      approvalRequest,
      pendingUserQuestion?.promptId,
      handleReviewFile,
      onApproveApproval,
      onRejectApproval,
      onOpenMarkdown,
      onPreviewMarkdown,
    ],
  )

  const handlePlanDecision = useCallback(
    async (promptId: string, optionId: string, freeText?: string) => {
      if (!sessionId) return
      try {
        await window.agentforge.agent.planDecision({
          sessionId,
          promptId,
          optionId,
          freeText,
        })
      } finally {
        resolvePlanPrompt(promptId)
      }
    },
    [sessionId, resolvePlanPrompt],
  )

  const handleUserQuestionSubmit = useCallback(
    async (answers: UserQuestionPromptAnswer[]) => {
      if (!activeUserQuestion || !sessionId) return

      setSubmittingQuestion(true)
      setQuestionSubmitError(null)
      const followUpPrompt = formatUserQuestionPromptAnswers(activeUserQuestion, answers)
      const createdAt = Date.now()

      try {
        const result = await window.agentforge.agent.dispatch({
          projectId: project.id,
          prompt: followUpPrompt,
          agentId: toSupportedAgentId(agentId),
          modelOverride,
          threadId: threadId ?? undefined,
        })
        onSessionStarted?.({
          sessionId: result.sessionId,
          threadId: result.threadId,
          prompt: followUpPrompt,
          routingDecision: null,
          agentId: toSupportedAgentId(agentId),
          modelOverride,
          createdAt,
        })
        resolveUserQuestion(activeUserQuestion.promptId)
        dismissedUserQuestionIdsRef.current.add(activeUserQuestion.promptId)
        setActiveUserQuestion(null)
      } catch (error: unknown) {
        setQuestionSubmitError(
          error instanceof Error ? error.message : 'Failed to send answers',
        )
      } finally {
        setSubmittingQuestion(false)
      }
    },
    [
      activeUserQuestion,
      agentId,
      modelOverride,
      onSessionStarted,
      project.id,
      resolveUserQuestion,
      sessionId,
      threadId,
    ],
  )

  const closeUserQuestion = useCallback((open: boolean) => {
    if (open || !activeUserQuestion) return

    dismissedUserQuestionIdsRef.current.add(activeUserQuestion.promptId)
    setActiveUserQuestion(null)
    setQuestionSubmitError(null)
  }, [activeUserQuestion])

  return (
    <div
      data-workspace-scroll="true"
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-5 sm:px-4"
    >
      {sessionId ? (
        <div className="mx-auto flex min-h-full w-full max-w-conversation flex-col gap-4">
          <RunSummary
            prompt={prompt}
            status={effectiveStatus}
            model={model}
            pendingApprovals={pendingApprovals}
            pendingQuestions={pendingQuestions}
          />
          <PriorThreadMessages
            turns={priorTurns}
            onOpenMarkdown={onOpenMarkdown}
            onPreviewMarkdown={onPreviewMarkdown}
          />
          <MessageStream
            activities={activities}
            activityTimes={activityTimes}
            sessionId={sessionId}
            loading={loading}
            running={
              effectiveStatus === 'running' || effectiveStatus === 'awaiting-approval'
            }
            seedUserMessage={seedUserMessage}
            streamHandlers={streamHandlers}
          />
          {approvalRequest && approvalRequest.risk !== 'high' ? (
            <ApprovalCallout
              request={approvalRequest}
              onApprove={onApproveApproval}
              onReject={onRejectApproval}
            />
          ) : null}
        </div>
      ) : (
        <EmptyRunState project={project} />
      )}

      {pendingPlanPrompt ? (
        <PlanPromptModal
          open
          onOpenChange={(open) => {
            if (!open) resolvePlanPrompt(pendingPlanPrompt.promptId)
          }}
          title={pendingPlanPrompt.title}
          options={pendingPlanPrompt.options}
          allowFreeText={pendingPlanPrompt.allowFreeText}
          onDecision={(optionId, freeText) =>
            handlePlanDecision(pendingPlanPrompt.promptId, optionId, freeText)
          }
        />
      ) : null}
      {activeUserQuestion ? (
        <UserQuestionPromptModal
          open
          prompt={activeUserQuestion}
          submitting={submittingQuestion}
          error={questionSubmitError}
          onOpenChange={closeUserQuestion}
          onSubmit={handleUserQuestionSubmit}
        />
      ) : null}
      {approvalRequest && approvalRequest.risk === 'high' ? (
        <Modal
          open={true}
          onOpenChange={(open: boolean) => {
            if (!open) void onRejectApproval()
          }}
          title="High-Risk Action Required"
          maxWidth={500}
        >
          <div className="flex flex-col gap-4">
            <div className="text-sm text-secondary">
              An agent is requesting approval to perform a high-risk operation.
            </div>

            <div className="rounded-card border border-accent-del/40 bg-accent-del/10 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-accent-del">
                  {approvalRequest.description}
                </span>
                <span className="inline-flex items-center rounded-pill border border-accent-del/40 bg-accent-del/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-del">
                  High Risk
                </span>
              </div>
              {approvalRequest.details ? (
                <div className="mt-2 text-xs text-secondary whitespace-pre-wrap break-words leading-relaxed">
                  {approvalRequest.details}
                </div>
              ) : null}
            </div>

            {approvalRequest.command ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Command</span>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-hairline bg-canvas px-3 py-2 font-mono text-[11px] text-secondary leading-relaxed">
                  {approvalRequest.command}
                </pre>
              </div>
            ) : null}

            {approvalRequest.cwd ? (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Working Directory</span>
                <div className="font-mono text-xs text-secondary truncate">{approvalRequest.cwd}</div>
              </div>
            ) : null}

            <div className="mt-2 flex items-center justify-end gap-3 border-t border-hairline pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onRejectApproval()}
              >
                Reject
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void onApproveApproval()}
              >
                Approve
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function toSupportedAgentId(agentId: Project['agentId'] | undefined): SupportedAgentId | undefined {
  if (typeof agentId === 'string' && SUPPORTED_AGENT_IDS.includes(agentId as SupportedAgentId)) {
    return agentId as SupportedAgentId
  }
  return undefined
}

function PriorThreadMessages({
  turns,
  onOpenMarkdown,
  onPreviewMarkdown,
}: {
  turns: ThreadTranscriptTurn[]
  onOpenMarkdown?: (request: MarkdownLinkRequest) => void
  onPreviewMarkdown?: (document: MarkdownPreviewDocument) => void
}) {
  const visibleTurns = turns.filter((turn) => turn.prompt.trim() || turn.assistantText?.trim())
  if (visibleTurns.length === 0) return null

  return (
    <div className="flex flex-col gap-4">
      {visibleTurns.map((turn) => (
        <section key={turn.sessionId} className="flex flex-col gap-3">
          {turn.prompt.trim() ? (
            <UserMessage
              text={turn.prompt}
              attachments={turn.imageAttachments}
              onOpenMarkdown={onOpenMarkdown}
            />
          ) : null}
          {turn.assistantText?.trim() ? (
            <AssistantMessage
              text={turn.assistantText}
              showActions={false}
              onOpenMarkdown={onOpenMarkdown}
              onPreviewMarkdown={onPreviewMarkdown}
            />
          ) : null}
        </section>
      ))}
    </div>
  )
}

function RunSummary({
  prompt,
  status,
  model,
  pendingApprovals,
  pendingQuestions,
}: {
  prompt: string
  status: SessionStatus | null
  model?: string
  pendingApprovals: number
  pendingQuestions: number
}) {
  const [copied, setCopied] = useState(false)
  const copyPrompt = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(prompt)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_200)
  }, [prompt])

  return (
    <div className="flex min-w-0 flex-col gap-3 border-b border-hairline pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        {prompt ? (
          <details className="group/prompt rounded-card border border-hairline bg-card/40">
            <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2 text-sm leading-6 text-primary">
              <span className="min-w-0 flex-1 break-words">
                {prompt}
              </span>
              <span className="mt-1 shrink-0 text-muted transition-transform group-open/prompt:rotate-90">
                {iconChevronRight}
              </span>
            </summary>
            <div className="border-t border-hairline px-3 py-2">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-6 text-primary">
                {prompt}
              </pre>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={copyPrompt}
                  className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-secondary hover:bg-white/5 hover:text-primary"
                >
                  <span aria-hidden="true">{iconCopy}</span>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </details>
        ) : (
          <div className="break-words text-sm leading-6 text-primary">
            Ask an agent to start a coding session.
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className={statusClass(status)}>{statusLabel(status)}</span>
          {model ? <span>{model}</span> : null}
          {pendingApprovals > 0 ? <span>{pendingApprovals} approval request</span> : null}
          {pendingQuestions > 0 ? <span>{pendingQuestions} question waiting</span> : null}
        </div>
      </div>
    </div>
  )
}

const iconCopy = (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="4" y="4" width="9" height="9" rx="1.5" />
    <path d="M11 4V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1" />
  </svg>
)

const iconChevronRight = (
  <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="m6 4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

function ApprovalCallout({
  request,
  onApprove,
  onReject,
}: {
  request: ApprovalRequest
  onApprove: () => void | Promise<void>
  onReject: () => void | Promise<void>
}) {
  return (
    <article className="rounded-card border border-accent-warn/40 bg-accent-warn/10 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="break-words text-sm font-semibold text-accent-warn">
            {request.description}
          </div>
          <p className="mt-1 line-clamp-2 break-words font-mono text-xs text-accent-warn/80">
            {request.details}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onReject()}
            className="rounded px-2.5 py-1.5 text-xs text-secondary hover:bg-white/5"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => void onApprove()}
            className="rounded-pill bg-accent-primary px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent-primary/85"
          >
            Approve
          </button>
        </div>
      </div>
    </article>
  )
}

function EmptyRunState({ project }: { project: Project }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center py-10">
      <div className="break-words text-sm font-semibold text-primary">
        Ready for {project.name}
      </div>
      <p className="mt-2 text-sm leading-6 text-muted">
        Ask for a code change, review, or investigation. The run timeline will show model output,
        commands, approvals, and code changes as structured events.
      </p>
    </div>
  )
}

function statusLabel(status: SessionStatus | null): string {
  if (!status) return 'idle'
  if (status === 'awaiting-approval') return 'awaiting review'
  if (status === 'awaiting-input') return 'awaiting answer'
  return status
}

function statusClass(status: SessionStatus | null): string {
  switch (status) {
    case 'running':
      return 'rounded border border-accent-primary/40 bg-accent-primary/10 px-2 py-0.5 text-accent-primary'
    case 'awaiting-approval':
      return 'rounded border border-accent-warn/40 bg-accent-warn/10 px-2 py-0.5 text-accent-warn'
    case 'awaiting-input':
      return 'rounded border border-accent-primary/40 bg-accent-primary/10 px-2 py-0.5 text-accent-primary'
    case 'done':
      return 'rounded border border-accent-add/30 bg-accent-add/10 px-2 py-0.5 text-accent-add'
    case 'error':
      return 'rounded border border-accent-del/40 bg-accent-del/10 px-2 py-0.5 text-accent-del'
    case 'cancelled':
      return 'rounded border border-hairline bg-card px-2 py-0.5 text-muted'
    default:
      return 'rounded border border-hairline bg-card px-2 py-0.5 text-muted'
  }
}
