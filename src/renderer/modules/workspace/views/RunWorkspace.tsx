import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SUPPORTED_AGENT_IDS } from '../../../../shared/types'
import type {
  AgentActivity,
  ApprovalRequest,
  DiffProposal,
  GitDiffReviewResult,
  ImageAttachment,
  Project,
  RunAuditRecord,
  SessionStatus,
  SupportedAgentId,
  ThreadTranscriptTurn,
} from '../../../../shared/types'
import { ChatBackgroundLayer } from '../components/ChatBackgroundLayer'
import { AssistantMessage } from '../components/AssistantMessage'
import { BackgroundAgentsCard } from '../components/BackgroundAgentsCard'
import type { BackgroundAgentsBlockingState } from '../components/BackgroundAgentsCard'
import type { BackgroundAgentUserQuestion } from '../lib/backgroundAgents'
import type { MarkdownLinkRequest } from '../components/MarkdownContent'
import type { MarkdownPreviewDocument } from '../components/MarkdownPreviewer'
import { MessageStream } from '../components/MessageStream'
import {
  isRunAuditUpdatedEvent,
  RUN_AUDIT_UPDATED_EVENT,
} from '../lib/runAuditEvents'
import {
  AnimatedDiffStat,
  DiffReviewCard,
  RunAuditTimelineCard,
} from '../components/artifacts'
import type { DiffReviewFixSelection } from '../components/artifacts'
import { PlanPromptModal } from '../components/modals/PlanPromptModal'
import {
  emitPlanModeReset,
  latestPlanReviewId,
  shouldContinuePlanModeAfterQuestionAnswer,
} from '../components/Composer/planMode'
import { formatModelLabel } from '../components/Composer/modelDisplay'
import {
  formatUserQuestionPromptAnswers,
  UserQuestionPromptModal,
  type UserQuestionPromptAnswer,
} from '../components/modals/UserQuestionPromptModal'
import { UserMessage } from '../components/UserMessage'
import { useAttentionSound } from '../hooks/useAttentionSound'
import { useChatBackground } from '../hooks/useChatBackground'
import {
  deriveTimedSessionActivities,
  useSessionEvents,
  type UserQuestionActivity,
} from '../hooks/useSessionEvents'
import type { DiffProposalScope } from '../hooks/useWorkspaceController'
import { buildUserQuestionFollowUpDispatchParams } from '../lib/userQuestionFollowUp'
import type { StartedSessionSummary } from '../../sessions/types'
import { Button, Modal } from '../../../components/ui'
import {
  getSessionChangedLineStats,
  getSessionDiffReviewState,
  isFinishedSessionStatus,
  sessionHasCodeChanges,
  type DiffReviewStateBySession,
  type SessionChangedLineStats,
  type SessionDiffReviewState,
} from './runWorkspaceState'

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
  planMode?: boolean
  diffProposals: DiffProposal[]
  approvalRequest: ApprovalRequest | null
  onApprovalRequest: (request: ApprovalRequest | null) => void
  onDiffProposals: (proposals: DiffProposal[], source?: DiffProposalScope) => void
  onStatusChange: (status: SessionStatus) => void
  onApproveApproval: () => void | Promise<void>
  onRejectApproval: () => void | Promise<void>
  onSessionStarted?: (session: StartedSessionSummary) => void
  /**
   * Opens the workspace right panel in diff mode after a run finishes.
   * Lifted from `WorkspaceView` so the final review CTA can open the diff tab.
   */
  onReviewFile?: (filePath?: string) => void
  onOpenAgentPanel?: () => void
  onOpenMarkdown?: (request: MarkdownLinkRequest) => void
  onPreviewMarkdown?: (document: MarkdownPreviewDocument) => void
  onRestorePrompt?: (prompt: string) => void
  /** Called with the context window percentage (0–100) after a session completes. */
  onContextPercent?: (percent: number | null) => void
  onBackgroundBlockingChange?: (blocking: BackgroundAgentsBlockingState | null) => void
}

const EMPTY_DIFF_REVIEW_STATE: SessionDiffReviewState<GitDiffReviewResult> = {
  result: null,
  loading: false,
  error: null,
}

function setSessionDiffReviewLoading(
  state: Readonly<DiffReviewStateBySession<GitDiffReviewResult>>,
  sessionId: string,
): DiffReviewStateBySession<GitDiffReviewResult> {
  const current = state[sessionId] ?? EMPTY_DIFF_REVIEW_STATE
  return {
    ...state,
    [sessionId]: {
      ...current,
      loading: true,
      error: null,
    },
  }
}

function setSessionDiffReviewResult(
  state: Readonly<DiffReviewStateBySession<GitDiffReviewResult>>,
  sessionId: string,
  result: GitDiffReviewResult,
): DiffReviewStateBySession<GitDiffReviewResult> {
  return {
    ...state,
    [sessionId]: {
      result,
      loading: false,
      error: null,
    },
  }
}

function setSessionDiffReviewError(
  state: Readonly<DiffReviewStateBySession<GitDiffReviewResult>>,
  sessionId: string,
  error: string,
): DiffReviewStateBySession<GitDiffReviewResult> {
  return {
    ...state,
    [sessionId]: {
      result: null,
      loading: false,
      error,
    },
  }
}

/**
 * Renders the message-stream column for an active session.
 *
 * M4: the standalone `<DiffSummaryCard>` was removed — diff proposals now
 * surface inline via `<EditedFilesCard>`, which is rendered by the message
 * stream's dispatch table whenever an `edited-files-group` synthetic item
 * appears. The proposals and approval callbacks travel down through
 * `streamHandlers` so inline artifacts stay pure presentation components.
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
  planMode,
  diffProposals,
  approvalRequest,
  onApprovalRequest,
  onDiffProposals,
  onStatusChange,
  onApproveApproval,
  onRejectApproval,
  onSessionStarted,
  onReviewFile,
  onOpenAgentPanel,
  onOpenMarkdown,
  onPreviewMarkdown,
  onRestorePrompt,
  onContextPercent,
  onBackgroundBlockingChange,
}: RunWorkspaceProps) {
  const [priorTurns, setPriorTurns] = useState<ThreadTranscriptTurn[]>([])
  const [auditRecords, setAuditRecords] = useState<RunAuditRecord[]>([])
  const [auditRefreshTrigger, setAuditRefreshTrigger] = useState(0)
  const [diffReviewBySession, setDiffReviewBySession] = useState<
    DiffReviewStateBySession<GitDiffReviewResult>
  >({})
  const [activeUserQuestion, setActiveUserQuestion] = useState<UserQuestionActivity | null>(null)
  const [activeBackgroundUserQuestion, setActiveBackgroundUserQuestion] =
    useState<BackgroundAgentUserQuestion | null>(null)
  const [backgroundAgentsRefreshKey, setBackgroundAgentsRefreshKey] = useState(0)
  const [questionSubmitError, setQuestionSubmitError] = useState<string | null>(null)
  const [submittingQuestion, setSubmittingQuestion] = useState(false)
  const dismissedUserQuestionIdsRef = useRef<Set<string>>(new Set())
  const lastPlanReviewResetKeyRef = useRef<string | null>(null)
  const diffReviewState = useMemo(
    () => getSessionDiffReviewState(diffReviewBySession, sessionId),
    [diffReviewBySession, sessionId],
  )
  const diffReview = diffReviewState.result
  const diffReviewLoading = diffReviewState.loading
  const diffReviewError = diffReviewState.error

  // Forwards session diff events to the upstream scoped store. The store
  // scopes proposals by thread first, so a stale callback fired after a
  // thread switch can't leak files into the new thread's "Edited N files"
  // card while follow-up sessions in the same thread keep the card visible.
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
  // Audible "agent needs you" alert — chimes on new questions, approvals, and
  // finished runs. Tune *when* it fires in src/renderer/lib/attentionSound.ts.
  useAttentionSound({
    questionPromptId: activeBackgroundUserQuestion?.key ?? pendingUserQuestion?.promptId ?? null,
    approvalPending: approvalRequest !== null,
    status,
  })

  const chatBg = useChatBackground()

  useEffect(() => {
    setPriorTurns([])
    if (!threadId) return

    let cancelled = false
    void window.agentforge.sessions
      .listThreadTranscript(threadId, {
        limit: 8,
        excludeSessionId: sessionId ?? undefined,
        excludeSpawnedAgents: true,
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
    setAuditRecords([])
    setAuditRefreshTrigger((t) => t + 1)
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return

    let cancelled = false
    const loadAuditRecords = async () => {
      const records = await window.agentforge.runs
        .listSessionAuditRecords(sessionId)
        .catch(() => [])
      if (cancelled) return
      setAuditRecords(records)
    }

    void loadAuditRecords()

    return () => {
      cancelled = true
    }
  }, [auditRefreshTrigger, sessionId])

  useEffect(() => {
    if (!sessionId) return

    const handleAuditUpdated = (event: Event) => {
      if (!isRunAuditUpdatedEvent(event)) return
      if (event.detail.sessionId !== sessionId) return
      setAuditRefreshTrigger((t) => t + 1)
    }

    window.addEventListener(RUN_AUDIT_UPDATED_EVENT, handleAuditUpdated)
    return () => window.removeEventListener(RUN_AUDIT_UPDATED_EVENT, handleAuditUpdated)
  }, [sessionId])

  // A pending agent question belongs to the *thread*, not one session run.
  // Queued follow-ups, steering, and answering all start a fresh `sessionId`
  // on the same thread; resetting on `sessionId` used to wipe an unanswered
  // question modal mid-flight. Only a real thread switch should clear it.
  const questionThreadKey = threadId ?? sessionId

  useEffect(() => {
    dismissedUserQuestionIdsRef.current = new Set()
    setActiveUserQuestion(null)
    setActiveBackgroundUserQuestion(null)
    setQuestionSubmitError(null)
  }, [questionThreadKey])

  // Plan mode should be one-shot: once a plan reaches review, reset the
  // composer's sticky plan toggle so follow-up prompts execute normally.
  useEffect(() => {
    if (typeof window === 'undefined' || !sessionId) return
    const reviewId = latestPlanReviewId(activities)
    if (!reviewId) return

    const key = `${sessionId}:${reviewId}`
    if (lastPlanReviewResetKeyRef.current === key) return

    lastPlanReviewResetKeyRef.current = key
    emitPlanModeReset(window)
  }, [activities, sessionId])

  useEffect(() => {
    if (!pendingUserQuestion || activeUserQuestion) return
    if (dismissedUserQuestionIdsRef.current.has(userQuestionKey(null, pendingUserQuestion.promptId))) return

    setActiveUserQuestion(pendingUserQuestion)
    setActiveBackgroundUserQuestion(null)
    setQuestionSubmitError(null)
  }, [activeUserQuestion, pendingUserQuestion])

  const effectiveStatus = status ?? (sessionId ? 'running' : null)
  const hasCodeChanges = sessionHasCodeChanges(activities, diffProposals)

  // Refresh audit records when session reaches a terminal state.
  useEffect(() => {
    if (!sessionId) return
    if (!effectiveStatus) return
    if (!isFinishedSessionStatus(effectiveStatus)) return
    setAuditRefreshTrigger((t) => t + 1)
  }, [effectiveStatus, sessionId])

  const canReviewCurrentDiff =
    isFinishedSessionStatus(effectiveStatus) && hasCodeChanges
  const changedLineStats = useMemo(
    () => getSessionChangedLineStats(activities, diffProposals),
    [activities, diffProposals],
  )
  const showFinalDiffReview =
    canReviewCurrentDiff &&
    onReviewFile !== undefined &&
    changedLineStats !== null &&
    changedLineStats.additions + changedLineStats.deletions > 0
  const showDiffReview =
    canReviewCurrentDiff ||
    diffReview !== null ||
    diffReviewLoading ||
    diffReviewError !== null
  const showBottomFooter =
    auditRecords.length > 0 ||
    showDiffReview ||
    (approvalRequest !== null && approvalRequest.risk !== 'high')
  const seedUserMessage = useMemo(() => {
    if (!prompt) return undefined
    if (startedAt === undefined) {
      return { text: prompt, attachments: imageAttachments }
    }
    return { text: prompt, attachments: imageAttachments, at: startedAt }
  }, [imageAttachments, prompt, startedAt])

  const handleReviewCurrentDiff = useCallback(async () => {
    if (!sessionId) return

    setDiffReviewBySession((current) => setSessionDiffReviewLoading(current, sessionId))
    try {
      const result = await window.agentforge.git.reviewCurrentDiff(
        project.id,
        threadId ?? undefined,
      )
      setDiffReviewBySession((current) =>
        setSessionDiffReviewResult(current, sessionId, result),
      )
    } catch (error) {
      setDiffReviewBySession((current) =>
        setSessionDiffReviewError(current, sessionId, formatDiffReviewError(error)),
      )
    }
  }, [project.id, sessionId, threadId])

  const handleFixDiffReview = useCallback(
    async (review: GitDiffReviewResult, selection: DiffReviewFixSelection) => {
      const fixPrompt = buildDiffReviewFixPrompt(review)
      const createdAt = Date.now()
      const result = await window.agentforge.agent.dispatch({
        projectId: project.id,
        prompt: fixPrompt,
        agentId: selection.agentId,
        modelOverride: selection.modelId,
        threadId: threadId ?? undefined,
      })
      onSessionStarted?.({
        sessionId: result.sessionId,
        threadId: result.threadId,
        prompt: fixPrompt,
        routingDecision: null,
        agentId: selection.agentId,
        modelOverride: selection.modelId,
        createdAt,
      })
    },
    [onSessionStarted, project.id, threadId],
  )

  const streamHandlers = useMemo(
    () => ({
      projectId: project.id,
      threadId,
      // Source the proposals from the scoped prop (filtered per active
      // session+thread upstream) — never from local state. The previous
      // local merge surfaced edits from the prior thread in the new
      // thread's trailing "Edited N files" card.
      diffProposals,
      approvalRequest,
      pendingUserQuestionPromptId: pendingUserQuestion?.promptId ?? null,
      sessionStatus: effectiveStatus,
      onApproveApproval,
      onRejectApproval,
      onMultitaskDecisionSettled: () => {
        setBackgroundAgentsRefreshKey((key) => key + 1)
      },
      onAnswerUserQuestion: (prompt: UserQuestionActivity) => {
        dismissedUserQuestionIdsRef.current.delete(userQuestionKey(null, prompt.promptId))
        setActiveUserQuestion(prompt)
        setActiveBackgroundUserQuestion(null)
        setQuestionSubmitError(null)
      },
      onSessionStarted,
      onOpenMarkdown,
      onPreviewMarkdown,
    }),
    [
      diffProposals,
      approvalRequest,
      pendingUserQuestion?.promptId,
      onApproveApproval,
      onRejectApproval,
      onSessionStarted,
      onOpenMarkdown,
      onPreviewMarkdown,
      effectiveStatus,
      project.id,
      threadId,
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
      const followUpPrompt = activeBackgroundUserQuestion
        ? formatBackgroundUserQuestionPromptAnswers(
            activeBackgroundUserQuestion,
            activeUserQuestion,
            answers,
          )
        : formatUserQuestionPromptAnswers(activeUserQuestion, answers)
      const createdAt = Date.now()

      try {
        const planModeFollowUp = shouldContinuePlanModeAfterQuestionAnswer(planMode)
        const result = await window.agentforge.agent.dispatch(
          buildUserQuestionFollowUpDispatchParams({
            projectId: project.id,
            prompt: followUpPrompt,
            agentId: toSupportedAgentId(agentId),
            modelOverride,
            threadId,
            planMode,
          }),
        )
        onSessionStarted?.({
          sessionId: result.sessionId,
          threadId: result.threadId,
          prompt: followUpPrompt,
          routingDecision: null,
          agentId: toSupportedAgentId(agentId),
          modelOverride,
          planMode: planModeFollowUp,
          createdAt,
        })
        const resolvedKey = userQuestionKey(
          activeBackgroundUserQuestion?.session.id ?? null,
          activeUserQuestion.promptId,
        )
        if (!activeBackgroundUserQuestion) {
          resolveUserQuestion(activeUserQuestion.promptId)
        }
        dismissedUserQuestionIdsRef.current.add(resolvedKey)
        setActiveUserQuestion(null)
        setActiveBackgroundUserQuestion(null)
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
      planMode,
      activeBackgroundUserQuestion,
      onSessionStarted,
      project.id,
      resolveUserQuestion,
      sessionId,
      threadId,
    ],
  )

  const closeUserQuestion = useCallback((open: boolean) => {
    if (open || !activeUserQuestion) return

    dismissedUserQuestionIdsRef.current.add(
      userQuestionKey(activeBackgroundUserQuestion?.session.id ?? null, activeUserQuestion.promptId),
    )
    setActiveUserQuestion(null)
    setActiveBackgroundUserQuestion(null)
    setQuestionSubmitError(null)
  }, [activeBackgroundUserQuestion, activeUserQuestion])

  const handleBackgroundUserQuestion = useCallback(
    (question: BackgroundAgentUserQuestion | null) => {
      if (!question) {
        if (activeBackgroundUserQuestion) {
          setActiveUserQuestion(null)
          setActiveBackgroundUserQuestion(null)
          setQuestionSubmitError(null)
        }
        return
      }
      if (dismissedUserQuestionIdsRef.current.has(question.key)) return
      if (activeBackgroundUserQuestion?.key === question.key) return
      if (activeUserQuestion && !activeBackgroundUserQuestion) return

      setActiveUserQuestion(question.prompt)
      setActiveBackgroundUserQuestion(question)
      setQuestionSubmitError(null)
    },
    [activeBackgroundUserQuestion, activeUserQuestion],
  )

  const handleBackgroundBlockingChange = useCallback(
    (blocking: BackgroundAgentsBlockingState | null) => {
      onBackgroundBlockingChange?.(blocking)
    },
    [onBackgroundBlockingChange],
  )

  return (
    <div
      data-workspace-scroll="true"
      className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-5 sm:px-4"
    >
      {chatBg.enabled && chatBg.dataUrl && (
        <ChatBackgroundLayer dataUrl={chatBg.dataUrl} settings={chatBg.settings} />
      )}
      {sessionId ? (
        <div className="relative z-[1] mx-auto flex min-h-full w-full max-w-conversation flex-col gap-4">
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
            canRestoreUserMessage={effectiveStatus === 'cancelled'}
            onRestoreUserMessage={onRestorePrompt}
          />
          <BackgroundAgentsCard
            projectId={project.id}
            threadId={threadId}
            refreshKey={backgroundAgentsRefreshKey}
            onBlockingChange={handleBackgroundBlockingChange}
            onUserQuestion={handleBackgroundUserQuestion}
          />
          {showFinalDiffReview ? (
            <FinalDiffReviewBar
              stats={changedLineStats}
              onReview={() => onReviewFile?.()}
            />
          ) : null}
          {showBottomFooter ? (
            <div className="flex flex-col gap-4">
              <RunAuditTimelineCard records={auditRecords} />
              {showDiffReview ? (
                <DiffReviewCard
                  result={diffReview}
                  loading={diffReviewLoading}
                  error={diffReviewError}
                  onReview={handleReviewCurrentDiff}
                  onFix={handleFixDiffReview}
                  onOpenAgentPanel={onOpenAgentPanel}
                  defaultFixModel={defaultDiffReviewFixModel(agentId, modelOverride ?? model)}
                />
              ) : null}
              {approvalRequest && approvalRequest.risk !== 'high' ? (
                <ApprovalCallout
                  request={approvalRequest}
                  onApprove={onApproveApproval}
                  onReject={onRejectApproval}
                />
              ) : null}
            </div>
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

function defaultDiffReviewFixModel(
  agentId: Project['agentId'] | undefined,
  modelId: string | undefined,
): DiffReviewFixSelection | null {
  const supportedAgentId = toSupportedAgentId(agentId)
  return supportedAgentId && modelId ? { agentId: supportedAgentId, modelId } : null
}

function formatDiffReviewError(error: unknown): string {
  const fallback = 'Failed to review current diff.'
  const message = error instanceof Error ? error.message : String(error || fallback)
  const ipcPrefix = "Error invoking remote method 'git:review-current-diff': Error: "

  return message.startsWith(ipcPrefix) ? message.slice(ipcPrefix.length) : message
}

function buildDiffReviewFixPrompt(review: GitDiffReviewResult): string {
  const findings =
    review.findings.length > 0
      ? review.findings
          .map((finding, index) =>
            [
              `${index + 1}. [${finding.severity}/${finding.category}] ${finding.title}`,
              finding.filePath ? `File: ${finding.filePath}${finding.line ? `:${finding.line}` : ''}` : null,
              `Detail: ${finding.detail}`,
              finding.recommendation ? `Recommendation: ${finding.recommendation}` : null,
            ]
              .filter(Boolean)
              .join('\n'),
          )
          .join('\n\n')
      : 'No concrete findings were returned.'

  return [
    'Fix the issues from the local diff review below.',
    '',
    'Rules:',
    '- Keep the fix scoped to the current working tree changes.',
    '- Do not revert unrelated user changes.',
    '- Add or update focused tests when the finding requires verification.',
    '',
    `Review summary: ${review.summary}`,
    `Branch: ${review.branch}`,
    `Diff: ${review.statusSummary}`,
    '',
    'Findings:',
    findings,
  ].join('\n')
}

function userQuestionKey(sourceSessionId: string | null, promptId: string): string {
  return `${sourceSessionId ?? 'main'}:${promptId}`
}

function formatBackgroundUserQuestionPromptAnswers(
  source: BackgroundAgentUserQuestion,
  prompt: UserQuestionActivity,
  answers: readonly UserQuestionPromptAnswer[],
): string {
  return [
    `Background agent "${source.session.spawnedAgent.role}" asked for input in the shared thread.`,
    `Background session: ${source.session.id}`,
    '',
    formatUserQuestionPromptAnswers(prompt, answers),
  ].join('\n')
}

function FinalDiffReviewBar({
  stats,
  onReview,
}: {
  stats: SessionChangedLineStats
  onReview: () => void
}) {
  return (
    <section className="sticky bottom-3 z-20">
      <div className="flex items-center justify-between gap-3 rounded-card border border-hairline/80 bg-card-raised/95 px-3 py-2 shadow-lg shadow-black/10 backdrop-blur">
        <div className="min-w-0">
          <div className="text-xs font-medium text-primary">
            Edited {stats.filesChanged} file{stats.filesChanged === 1 ? '' : 's'}
          </div>
          <div className="mt-0.5 text-[11px] text-muted">
            Final working-tree changes
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={onReview}
          trailingIcon={
            <AnimatedDiffStat
              additions={stats.additions}
              deletions={stats.deletions}
              variant="onAccent"
              className="text-[11px]"
            />
          }
        >
          Review
        </Button>
      </div>
    </section>
  )
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
  const visibleTurns = turns.filter(
    (turn) => turn.prompt.trim() || turn.events.length > 0 || turn.assistantText?.trim(),
  )
  if (visibleTurns.length === 0) return null

  return (
    <div className="flex flex-col gap-4">
      {visibleTurns.map((turn) => (
        <PriorThreadTurn
          key={turn.sessionId}
          turn={turn}
          onOpenMarkdown={onOpenMarkdown}
          onPreviewMarkdown={onPreviewMarkdown}
        />
      ))}
    </div>
  )
}

function PriorThreadTurn({
  turn,
  onOpenMarkdown,
  onPreviewMarkdown,
}: {
  turn: ThreadTranscriptTurn
  onOpenMarkdown?: (request: MarkdownLinkRequest) => void
  onPreviewMarkdown?: (document: MarkdownPreviewDocument) => void
}) {
  const timedActivities = useMemo(
    () => deriveTimedSessionActivities(turn.events),
    [turn.events],
  )
  const activities = useMemo(
    () => timedActivities.map(({ activity }) => activity),
    [timedActivities],
  )
  const activityTimes = useMemo(
    () => timedActivities.map(({ at }) => at),
    [timedActivities],
  )
  const seedUserMessage = turn.prompt.trim()
    ? {
        text: turn.prompt,
        attachments: turn.imageAttachments,
        at: turn.createdAt,
      }
    : undefined

  if (activities.length > 0 || seedUserMessage) {
    return (
      <MessageStream
        activities={activities}
        activityTimes={activityTimes}
        sessionId={turn.sessionId}
        running={false}
        seedUserMessage={seedUserMessage}
        showAssistantActions={false}
        streamHandlers={{
          onOpenMarkdown,
          onPreviewMarkdown,
        }}
      />
    )
  }

  if (!turn.assistantText?.trim()) return null

  return (
    <section className="flex flex-col gap-3">
      <AssistantMessage
        text={turn.assistantText}
        showActions={false}
        onOpenMarkdown={onOpenMarkdown}
        onPreviewMarkdown={onPreviewMarkdown}
      />
    </section>
  )
}

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
