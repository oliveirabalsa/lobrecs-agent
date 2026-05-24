import type { ImageAttachment } from '../../../../shared/types'
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
export function UserMessage({ text, attachments, onOpenMarkdown }: UserMessageProps) {
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
    <div className="shadow-elevated ml-auto max-w-[85%] rounded-bubble bg-bubble-user px-4 py-3 text-sm leading-6 text-primary sm:max-w-[70%]">
      {attachments && attachments.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <AttachmentThumb
              key={attachment.filePath}
              src={resolveAttachmentSrc(attachment)}
              name={resolveAttachmentName(attachment)}
            />
          ))}
        </div>
      ) : null}
      <MarkdownContent text={text} variant="compact" onOpenMarkdown={onOpenMarkdown} />
    </div>
  )
}
