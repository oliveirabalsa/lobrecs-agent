import type { ReactNode } from 'react'
import type {
  AgentActivity,
  ApprovalRequest,
  DiffProposal,
} from '../../../../shared/types'
import { AssistantMessage } from '../components/AssistantMessage'
import type { MarkdownLinkRequest } from '../components/MarkdownContent'
import type { MarkdownPreviewDocument } from '../components/MarkdownPreviewer'
import {
  ApprovalRequestPill,
  Callout,
  CommandPreview,
  CommandsGroup,
  CompletionFooter,
  EditedFilesCard,
  PlanReviewCard,
  RanCommandsPill,
  UserQuestionPromptCard,
} from '../components/artifacts'
import type { UserQuestionActivity } from '../components/artifacts'
import type { StreamItem } from './groupTurns'
import {
  shouldSuppressUserQuestionToolResult,
  userQuestionActivityFromToolPayload,
} from '../../../../shared/contracts/userQuestionPrompts'

/**
 * Context passed from `RunWorkspace` → `MessageStream` → the dispatch table.
 * Carries live run state + callbacks the artifacts need (approvals, diffs).
 */
export interface RendererContext {
  sessionId: string | null
  running: boolean
  /** Live diff proposals from the parent — used by EditedFilesCard. */
  diffProposals?: DiffProposal[]
  /** Pending approval request, surfaced by ApprovalRequestPill. */
  approvalRequest?: ApprovalRequest | null
  /** Latest unresolved agent question. Used to highlight its timeline card. */
  pendingUserQuestionPromptId?: string | null
  onReviewFile?: (filePath?: string) => void
  onApproveApproval?: () => void | Promise<void>
  onRejectApproval?: () => void | Promise<void>
  onAnswerUserQuestion?: (prompt: UserQuestionActivity) => void
  onOpenMarkdown?: (request: MarkdownLinkRequest) => void
  onPreviewMarkdown?: (document: MarkdownPreviewDocument) => void
}

const EMPTY_CONTEXT: RendererContext = {
  sessionId: null,
  running: false,
}

function hasLiveDiffProposals(proposals: DiffProposal[]): boolean {
  return proposals.length > 0
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
        const proposals = (ctx.diffProposals ?? []).filter(
          (proposal) => proposal.filePath === item.filePath,
        )
        const hasLiveProposals = hasLiveDiffProposals(proposals)
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
            onReview={hasLiveProposals ? ctx.onReviewFile : undefined}
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
      if (!ctx.sessionId) return null
      return (
        <PlanReviewCard key={key} reviewId={item.reviewId} sessionId={ctx.sessionId} />
      )

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

    case 'edited-files-group': {
      // Prefer live DiffProposals from the parent — they carry actual content
      // and additions/deletions. Fall back to the activity-derived rows when
      // no proposals are present yet.
      const proposals = (ctx.diffProposals ?? []).filter((proposal) =>
        item.items.some((change) => change.filePath === proposal.filePath),
      )
      const hasLiveProposals = hasLiveDiffProposals(proposals)
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
          onReview={hasLiveProposals ? ctx.onReviewFile : undefined}
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
