import type { ReactNode } from 'react'
import type {
  AgentActivity,
  ApprovalRequest,
  DiffProposal,
  SessionStatus,
} from '../../../../shared/types'
import { AssistantMessage } from '../components/AssistantMessage'
import type { MarkdownLinkRequest } from '../components/MarkdownContent'
import type { MarkdownPreviewDocument } from '../components/MarkdownPreviewer'
import {
  ApprovalRequestPill,
  Callout,
  CommandPreview,
  CommandsGroup,
  DelegationCard,
  CompletionFooter,
  EditedFilesCard,
  McpCallCard,
  ModelRecoveryCard,
  MultitaskPlanCard,
  PlanReviewCard,
  RanCommandsPill,
  SwarmStepApprovalCard,
  TodoCard,
  UserQuestionPromptCard,
} from '../components/artifacts'
import type { CardOutcome as MultitaskPlanOutcome } from '../components/artifacts/MultitaskPlanCard'
import type { UserQuestionActivity } from '../components/artifacts'
import type { StartedSessionSummary } from '../../sessions/types'
import type { StreamItem } from './groupTurns'
import { matchingDiffProposals } from './diffProposalMatching'
import { isMcpToolActivity } from './mcpActivity'
import {
  shouldSuppressUserQuestionToolResult,
  userQuestionActivityFromToolPayload,
} from '../../../../shared/contracts/userQuestionPrompts'

/**
 * Context passed from `RunWorkspace` → `MessageStream` → the dispatch table.
 * Carries live run state + callbacks the artifacts need (approvals, diffs).
 */
export interface RendererContext {
  projectId?: string | null
  threadId?: string | null
  sessionId: string | null
  running: boolean
  /** Live diff proposals from the parent — used by EditedFilesCard. */
  diffProposals?: DiffProposal[]
  /** Pending approval request, surfaced by ApprovalRequestPill. */
  approvalRequest?: ApprovalRequest | null
  /** Latest unresolved agent question. Used to highlight its timeline card. */
  pendingUserQuestionPromptId?: string | null
  /** Current owner-session status, used to make replayed artifacts durable. */
  sessionStatus?: SessionStatus | null
  onApproveApproval?: () => void | Promise<void>
  onRejectApproval?: () => void | Promise<void>
  onAnswerUserQuestion?: (prompt: UserQuestionActivity) => void
  onMultitaskDecisionSettled?: () => void
  onSessionStarted?: (session: StartedSessionSummary) => void
  onOpenMarkdown?: (request: MarkdownLinkRequest) => void
  onPreviewMarkdown?: (document: MarkdownPreviewDocument) => void
  /** The plan text shown above an inline plan-review control, when present. */
  planReviewPlanText?: string
}

const EMPTY_CONTEXT: RendererContext = {
  projectId: null,
  sessionId: null,
  running: false,
}

/**
 * Dispatch table: `StreamItem` (real activity OR synthetic aggregation
 * group) → rendered React node. Replaces the old `renderActivity` switch
 * that produced placeholder pills.
 */
export function renderStreamItem(
  item: StreamItem,
  key: string | number,
  ctx: RendererContext = EMPTY_CONTEXT,
): ReactNode {
  switch (item.kind) {
    case 'message': {
      if (item.role === 'assistant') {
        return (
          <AssistantMessage
            key={key}
            text={item.text}
            onOpenMarkdown={ctx.onOpenMarkdown}
            onPreviewMarkdown={ctx.onPreviewMarkdown}
          />
        )
      }
      // System messages: route to Callout when they look like warnings.
      const text = item.text ?? ''
      const lower = text.toLowerCase()
      const isWarning =
        text.trim().startsWith('⚠') ||
        lower.includes('deprecated') ||
        lower.includes('warning')
      if (isWarning) {
        return (
          <Callout key={key} variant="warn">
            {text}
          </Callout>
        )
      }
      return (
        <div
          key={key}
          className="self-start whitespace-pre-wrap rounded-card border border-hairline bg-card px-3 py-2 text-xs leading-5 text-muted"
        >
          <span className="mr-2 text-[10px] font-medium uppercase tracking-wide opacity-70">
            {item.role}
          </span>
          {text}
        </div>
      )
    }

    case 'compaction':
    case 'plan-prompt':
      // Handled by `MessageStream` (Divider) and `RunWorkspace` (modal).
      return null

    case 'user-question':
      return (
        <UserQuestionPromptCard
          key={key}
          prompt={item}
          active={ctx.pendingUserQuestionPromptId === item.promptId}
          onAnswer={ctx.onAnswerUserQuestion}
        />
      )

    case 'completion':
      return (
        <CompletionFooter
          key={key}
          tokensIn={item.tokensIn}
          tokensOut={item.tokensOut}
          costUsd={item.costUsd}
        />
      )

    case 'command':
      return (
        <CommandPreview
          key={key}
          command={item.command}
          cwd={item.cwd}
          status={item.status}
        />
      )

    case 'tool-call': {
      const userQuestion = userQuestionActivityFromToolPayload(item)
      if (userQuestion) {
        return (
          <UserQuestionPromptCard
            key={key}
            prompt={userQuestion}
            active={ctx.pendingUserQuestionPromptId === userQuestion.promptId}
            onAnswer={ctx.onAnswerUserQuestion}
          />
        )
      }

      if (isMcpToolActivity(item)) {
        return <McpCallCard key={key} items={[item]} running={ctx.running} />
      }

      // When a tool-call/result lands by itself (not part of a batch),
      // render as a slim mono pill rather than a full RanCommands group.
      return (
        <div
          key={key}
          className="inline-flex max-w-full items-center gap-2 self-start rounded-pill border border-hairline bg-card-raised px-2.5 py-1 text-[11px] text-secondary"
        >
          <span className="font-medium uppercase tracking-wide text-muted">
            {item.kind === 'tool-call' ? 'call' : 'result'}
          </span>
          <span className="min-w-0 truncate font-mono text-primary" title={item.name}>
            {item.name}
          </span>
        </div>
      )
    }

    case 'tool-result':
      if (shouldSuppressUserQuestionToolResult(item.name, item.output)) return null

      if (isMcpToolActivity(item)) {
        return <McpCallCard key={key} items={[item]} running={ctx.running} />
      }

      // When a tool-call/result lands by itself (not part of a batch),
      // render as a slim mono pill rather than a full RanCommands group.
      return (
        <div
          key={key}
          className="inline-flex max-w-full items-center gap-2 self-start rounded-pill border border-hairline bg-card-raised px-2.5 py-1 text-[11px] text-secondary"
        >
          <span className="font-medium uppercase tracking-wide text-muted">
            result
          </span>
          <span className="min-w-0 truncate font-mono text-primary" title={item.name}>
            {item.name}
          </span>
        </div>
      )

    case 'file-change':
      {
        const proposals = matchingDiffProposals(ctx.diffProposals ?? [], item.filePath)
        return (
          <EditedFilesCard
            key={key}
            proposals={proposals}
            fallbackFiles={[
              {
                filePath: item.filePath,
                additions: item.additions,
                deletions: item.deletions,
                changeType: item.changeType,
              },
            ]}
          />
        )
      }

    case 'diff-summary':
      // Superseded by EditedFilesCard — hide so it doesn't double up.
      return null

    case 'approval':
      if (!ctx.sessionId) return null
      return (
        <ApprovalRequestPill
          key={key}
          request={item.request}
          sessionId={ctx.sessionId}
          onApprove={ctx.onApproveApproval}
          onReject={ctx.onRejectApproval}
        />
      )

    case 'plan-review':
      if (!ctx.sessionId || !ctx.projectId) return null
      return (
        <PlanReviewCard
          key={key}
          reviewId={item.reviewId}
          sessionId={ctx.sessionId}
          projectId={ctx.projectId}
          threadId={ctx.threadId}
          planText={ctx.planReviewPlanText}
          agentId={item.agentId}
          planningModel={item.model}
          onMultitaskSessionStarted={ctx.onSessionStarted}
          onPreviewMarkdown={ctx.onPreviewMarkdown}
        />
      )

    case 'swarm-step-approval':
      if (!ctx.sessionId) return null
      return (
        <SwarmStepApprovalCard
          key={key}
          approval={item}
          sessionId={ctx.sessionId}
        />
      )

    case 'model-recovery':
      if (!ctx.sessionId) return null
      return (
        <ModelRecoveryCard
          key={key}
          recovery={item}
          sessionId={ctx.sessionId}
          onSessionStarted={ctx.onSessionStarted}
        />
      )

    case 'multitask-plan':
      if (!ctx.sessionId) return null
      return (
        <MultitaskPlanCard
          key={key}
          planId={item.planId}
          sessionId={ctx.sessionId}
          tasks={item.tasks}
          totalEstimatedCostUsd={item.totalEstimatedCostUsd}
          decomposedBy={item.decomposedBy}
          resolvedOutcome={multitaskPlanOutcomeFromSessionStatus(ctx.sessionStatus)}
          onDecisionSettled={ctx.onMultitaskDecisionSettled}
        />
      )

    case 'todo-list':
      return <TodoCard key={key} activity={item} />

    case 'delegation':
      return <DelegationCard key={key} delegation={item} />

    case 'step':
      // Informational steps (worktree created, model starting, "thinking", …)
      // are absorbed by the rotating WorkingState label below the stream so
      // we don't carpet the timeline with low-signal pills. Errors still need
      // to be visible, so surface those as a warning callout.
      if (item.status === 'error') {
        return (
          <Callout key={key} variant="warn" title={item.title}>
            {item.detail ?? ''}
          </Callout>
        )
      }
      return null

    case 'ran-commands-group':
      return (
        <CommandsGroup
          key={key}
          type={item.type}
          items={item.items}
          running={ctx.running}
        />
      )

    case 'mcp-calls-group':
      return <McpCallCard key={key} items={item.items} running={ctx.running} />

    case 'edited-files-group': {
      // Prefer live DiffProposals from the parent — they carry actual content
      // and additions/deletions. Fall back to the activity-derived rows when
      // no proposals are present yet.
      const proposalsByPath = new Map<string, DiffProposal>()
      for (const change of item.items) {
        for (const proposal of matchingDiffProposals(ctx.diffProposals ?? [], change.filePath)) {
          proposalsByPath.set(proposal.filePath, proposal)
        }
      }
      const proposals = [...proposalsByPath.values()]
      const fallback = item.items.map((change) => ({
        filePath: change.filePath,
        additions: change.additions,
        deletions: change.deletions,
        changeType: change.changeType,
      }))
      return (
        <EditedFilesCard
          key={key}
          proposals={proposals}
          fallbackFiles={fallback}
        />
      )
    }

    default: {
      // Exhaustiveness guard. New synthetic kinds will trip this at compile time.
      const _exhaustive: never = item
      void _exhaustive
      return null
    }
  }
}

export function multitaskPlanOutcomeFromSessionStatus(
  status: SessionStatus | null | undefined,
): MultitaskPlanOutcome | null {
  if (status === 'done') return 'approved'
  if (status === 'cancelled') return 'rejected'
  if (status === 'error') return 'failed'
  return null
}

/**
 * Backwards-compatible single-activity renderer kept for callers that still
 * work on `AgentActivity` directly (e.g. tests).
 */
export function renderActivity(
  activity: AgentActivity,
  key: string | number,
  ctx: RendererContext = EMPTY_CONTEXT,
): ReactNode {
  return renderStreamItem(activity as StreamItem, key, ctx)
}
