import { isImageAttachment, type ImageAttachment } from '../../../../shared/types'
import { parseSwarmRolePrompt } from '../lib/swarmMessage'
import { parsePlanModeQuestionAnswer } from '../lib/planModeQuestionAnswer'
import {
  AttachmentThumb,
  resolveAttachmentName,
  resolveAttachmentSrc,
} from './AttachmentThumb'
import { MarkdownContent, type MarkdownLinkRequest } from './MarkdownContent'
import {
  isPlanModeExecutionPrompt,
  PlanModeExecutionMessage,
} from './PlanModeExecutionMessage'
import { SwarmRoleMessage } from './SwarmRoleMessage'
import { QuestionAnswerCard } from './QuestionAnswerCard'

export interface UserMessageProps {
  text: string
  attachments?: ImageAttachment[]
  onOpenMarkdown?: (request: MarkdownLinkRequest) => void
  onRestoreDraft?: (text: string) => void
}

/**
 * Right-aligned user message bubble (Codex shell §2.4).
 *
 * User prompts use the same safe markdown renderer as assistant messages, but
 * in compact mode so headings and code blocks fit inside the bubble.
 *
 * Auto-dispatched swarm worker prompts arrive with a `[Role: ...]` header —
 * those render through `SwarmRoleMessage` instead so the machine-generated
 * handoff reads as a labelled card rather than raw plumbing text.
 */
export function UserMessage({
  text,
  attachments,
  onOpenMarkdown,
  onRestoreDraft,
}: UserMessageProps) {
  const swarmRole = parseSwarmRolePrompt(text)
  if (swarmRole) {
    return (
      <SwarmRoleMessage
        role={swarmRole.role}
        body={swarmRole.body}
        attachments={attachments}
        onOpenMarkdown={onOpenMarkdown}
      />
    )
  }

  if (isPlanModeExecutionPrompt(text)) {
    return <PlanModeExecutionMessage />
  }

  const planModeQuestionAnswer = parsePlanModeQuestionAnswer(text)
  if (planModeQuestionAnswer) {
    return <QuestionAnswerCard view={planModeQuestionAnswer} />
  }

  return (
    <div className="group relative ml-auto max-w-[90%] sm:max-w-[72%]">
      {onRestoreDraft ? (
        <button
          type="button"
          onClick={() => onRestoreDraft(text)}
          className="absolute -left-8 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-hairline bg-card-raised text-muted opacity-0 shadow-elevated transition hover:border-white/15 hover:bg-white/10 hover:text-primary focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/60 group-hover:opacity-100"
          title="Edit stopped prompt"
          aria-label="Edit stopped prompt"
        >
          <RestoreDraftIcon />
        </button>
      ) : null}
      <div className="rounded-[16px] border border-hairline-strong bg-bubble-user/80 px-3.5 py-2.5 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_1px_2px_rgba(0,0,0,0.18)]">
        {attachments && attachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((attachment) => (
              <AttachmentThumb
                key={attachment.filePath}
                src={isImageAttachment(attachment) ? resolveAttachmentSrc(attachment) : undefined}
                name={resolveAttachmentName(attachment)}
              />
            ))}
          </div>
        ) : null}
        <MarkdownContent
          text={text}
          variant="compact"
          className="[font-size:13px] [line-height:1.52]"
          onOpenMarkdown={onOpenMarkdown}
        />
      </div>
    </div>
  )
}

function RestoreDraftIcon() {
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
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
    </svg>
  )
}
