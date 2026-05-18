import type { AgentActivity } from '../../../../../shared/types'
import { Button } from '../../../../components/ui'

export type UserQuestionActivity = Extract<AgentActivity, { kind: 'user-question' }>

export interface UserQuestionPromptCardProps {
  prompt: UserQuestionActivity
  active?: boolean
  onAnswer?: (prompt: UserQuestionActivity) => void
}

/**
 * Compact timeline artifact for agent questions. The full answer form lives in
 * `UserQuestionPromptModal`; this card keeps historical sessions readable.
 */
export function UserQuestionPromptCard({
  prompt,
  active = false,
  onAnswer,
}: UserQuestionPromptCardProps) {
  const count = prompt.questions.length

  return (
    <div className="self-start rounded-card border border-accent-primary/30 bg-card px-3 py-2.5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-accent-primary">
            Agent question{count === 1 ? '' : 's'}
          </div>
          <div className="mt-1 text-sm font-medium leading-5 text-primary">
            {prompt.title}
          </div>
        </div>
        {onAnswer ? (
          <Button
            variant={active ? 'primary' : 'chip'}
            size="sm"
            onClick={() => onAnswer(prompt)}
          >
            Answer
          </Button>
        ) : null}
      </div>

      <ol className="mt-2 flex flex-col gap-2">
        {prompt.questions.map((question, index) => (
          <li key={question.id} className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
              {question.header ?? `Question ${index + 1}`}
            </div>
            <div className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-primary">
              {question.question}
            </div>
            {question.options.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {question.options.slice(0, 4).map((option) => (
                  <span
                    key={option.id}
                    className="max-w-full truncate rounded-pill border border-hairline bg-card-raised px-2 py-0.5 text-[11px] text-secondary"
                    title={option.label}
                  >
                    {option.label}
                  </span>
                ))}
                {question.options.length > 4 ? (
                  <span className="rounded-pill border border-hairline bg-card-raised px-2 py-0.5 text-[11px] text-muted">
                    +{question.options.length - 4}
                  </span>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  )
}
