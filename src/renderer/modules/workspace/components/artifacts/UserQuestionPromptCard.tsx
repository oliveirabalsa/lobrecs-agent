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
  const totalOptions = prompt.questions.reduce(
    (sum, question) => sum + question.options.length,
    0,
  )

  return (
    <article
      className={[
        'self-start rounded-card border px-3 py-3 shadow-sm',
        active
          ? 'border-accent-primary/50 bg-accent-primary/10'
          : 'border-hairline bg-card',
      ].join(' ')}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase text-accent-primary">
            <span>Agent question{count === 1 ? '' : 's'}</span>
            {active ? (
              <span className="rounded-pill border border-accent-primary/35 bg-accent-primary/10 px-2 py-0.5 normal-case text-accent-primary">
                Waiting for you
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-sm font-medium leading-5 text-primary">
            {prompt.title}
          </div>
          <div className="mt-1 text-xs leading-5 text-secondary">
            {count} required question{count === 1 ? '' : 's'}
            {totalOptions > 0 ? `, ${totalOptions} option${totalOptions === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        {onAnswer ? (
          <Button
            variant={active ? 'primary' : 'chip'}
            size="sm"
            onClick={() => onAnswer(prompt)}
            aria-label={`Answer ${prompt.title}`}
          >
            Choose answer
          </Button>
        ) : null}
      </div>

      <ol className="mt-3 flex flex-col gap-2">
        {prompt.questions.map((question, index) => (
          <li key={question.id} className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
              {question.header ?? `Question ${index + 1}`}
            </div>
            <div className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-primary">
              {question.question}
            </div>
            {question.options.length > 0 ? (
              <div className="mt-2 grid gap-1.5">
                {question.options.slice(0, 3).map((option) => (
                  <div
                    key={option.id}
                    className="min-w-0 rounded-card border border-hairline bg-card-raised px-2 py-1.5"
                    title={option.label}
                  >
                    <div className="break-words text-[12px] font-medium leading-4 text-primary">
                      {option.label}
                    </div>
                    {option.description ? (
                      <div className="mt-0.5 break-words text-[11px] leading-4 text-secondary">
                        {option.description}
                      </div>
                    ) : null}
                  </div>
                ))}
                {question.options.length > 3 ? (
                  <div className="text-[11px] text-muted">
                    +{question.options.length - 3} more option
                    {question.options.length - 3 === 1 ? '' : 's'}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 rounded-card border border-hairline bg-card-raised px-2 py-1.5 text-[11px] text-secondary">
                Free-text answer required
              </div>
            )}
          </li>
        ))}
      </ol>
    </article>
  )
}
