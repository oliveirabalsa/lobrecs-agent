import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ApprovalRequest,
  DiffProposal,
  Project,
  SessionStatus,
  SupportedAgentId,
  ThreadTranscriptTurn,
} from '../../../../shared/types'
import { AssistantMessage } from '../components/AssistantMessage'
import { MessageStream } from '../components/MessageStream'
import { PlanPromptModal } from '../components/modals/PlanPromptModal'
import {
  formatUserQuestionPromptAnswers,
  UserQuestionPromptModal,
  type UserQuestionPromptAnswer,
} from '../components/modals/UserQuestionPromptModal'
import { UserMessage } from '../components/UserMessage'
import { useSessionEvents, type UserQuestionActivity } from '../hooks/useSessionEvents'
import type { StartedSessionSummary } from '../../sessions/types'

interface RunWorkspaceProps {
  project: Project
  sessionId: string | null
  threadId?: string | null
  prompt: string
  status: SessionStatus | null
  startedAt?: number
  agentId?: Project['agentId']
  model?: string
  modelOverride?: string
  diffProposals: DiffProposal[]
  approvalRequest: ApprovalRequest | null
  onApprovalRequest: (request: ApprovalRequest | null) => void
  onDiffProposals: (proposals: DiffProposal[]) => void
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
}: RunWorkspaceProps) {
  const {
    activities,
    activityTimes,
    loading,
    pendingPlanPrompt,
    pendingUserQuestion,
    resolvePlanPrompt,
    resolveUserQuestion,
  } = useSessionEvents(sessionId, {
    onApprovalRequest,
    onDiffProposals,
    onStatusChange,
  })
  const [priorTurns, setPriorTurns] = useState<ThreadTranscriptTurn[]>([])
  const [activeUserQuestion, setActiveUserQuestion] = useState<UserQuestionActivity | null>(null)
  const [questionSubmitError, setQuestionSubmitError] = useState<string | null>(null)
  const [submittingQuestion, setSubmittingQuestion] = useState(false)
  const dismissedUserQuestionIdsRef = useRef<Set<string>>(new Set())

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

  useEffect(() => {
    dismissedUserQuestionIdsRef.current = new Set()
    setActiveUserQuestion(null)
    setQuestionSubmitError(null)
  }, [sessionId])

  useEffect(() => {
    if (!pendingUserQuestion || activeUserQuestion) return
    if (dismissedUserQuestionIdsRef.current.has(pendingUserQuestion.promptId)) return

    setActiveUserQuestion(pendingUserQuestion)
    setQuestionSubmitError(null)
  }, [activeUserQuestion, pendingUserQuestion])

  const pendingApprovals = approvalRequest ? 1 : 0
  const effectiveStatus = status ?? (sessionId ? 'running' : null)
  const seedUserMessage = useMemo(() => {
    if (!prompt) return undefined
    return startedAt === undefined ? { text: prompt } : { text: prompt, at: startedAt }
  }, [prompt, startedAt])

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
    }),
    [
      diffProposals,
      approvalRequest,
      pendingUserQuestion?.promptId,
      handleReviewFile,
      onApproveApproval,
      onRejectApproval,
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
        <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col gap-4">
          <RunSummary
            prompt={prompt}
            status={effectiveStatus}
            model={model}
            pendingApprovals={pendingApprovals}
          />
          <PriorThreadMessages turns={priorTurns} />
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
          {approvalRequest ? (
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
    </div>
  )
}

function toSupportedAgentId(agentId: Project['agentId'] | undefined): SupportedAgentId | undefined {
  if (agentId === 'claude-code' || agentId === 'codex' || agentId === 'opencode') {
    return agentId
  }
  return undefined
}

function PriorThreadMessages({ turns }: { turns: ThreadTranscriptTurn[] }) {
  const visibleTurns = turns.filter((turn) => turn.prompt.trim() || turn.assistantText?.trim())
  if (visibleTurns.length === 0) return null

  return (
    <div className="flex flex-col gap-4">
      {visibleTurns.map((turn) => (
        <section key={turn.sessionId} className="flex flex-col gap-3">
          {turn.prompt.trim() ? <UserMessage text={turn.prompt} /> : null}
          {turn.assistantText?.trim() ? (
            <AssistantMessage text={turn.assistantText} showActions={false} />
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
}: {
  prompt: string
  status: SessionStatus | null
  model?: string
  pendingApprovals: number
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
  return status
}

function statusClass(status: SessionStatus | null): string {
  switch (status) {
    case 'running':
      return 'rounded border border-accent-primary/40 bg-accent-primary/10 px-2 py-0.5 text-accent-primary'
    case 'awaiting-approval':
      return 'rounded border border-accent-warn/40 bg-accent-warn/10 px-2 py-0.5 text-accent-warn'
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
