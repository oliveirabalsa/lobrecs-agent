import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  UserQuestionPromptOption,
  UserQuestionPromptQuestion,
} from '../../../../../shared/types'
import type { UserQuestionActivity } from '../artifacts/UserQuestionPromptCard'
import { Button, Modal, Spinner } from '../../../../components/ui'

export interface UserQuestionPromptAnswer {
  questionId: string
  header?: string
  question: string
  selectedOptionIds: string[]
  selectedLabels: string[]
  freeText?: string
}

export interface UserQuestionPromptModalProps {
  open: boolean
  prompt: UserQuestionActivity
  submitting?: boolean
  error?: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (answers: UserQuestionPromptAnswer[]) => void | Promise<void>
}

type SelectionState = Record<string, string[]>
type TextState = Record<string, string>

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function UserQuestionPromptModal({
  open,
  prompt,
  submitting = false,
  error,
  onOpenChange,
  onSubmit,
}: UserQuestionPromptModalProps) {
  const [selections, setSelections] = useState<SelectionState>({})
  const [textAnswers, setTextAnswers] = useState<TextState>({})

  useEffect(() => {
    if (!open) return
    setSelections(initialSelections(prompt.questions))
    setTextAnswers(initialTextAnswers(prompt.questions))
  }, [open, prompt.promptId, prompt.questions])

  const canSubmit = useMemo(
    () => prompt.questions.every((question) => questionAnswered(question, selections, textAnswers)),
    [prompt.questions, selections, textAnswers],
  )

  function toggleOption(question: UserQuestionPromptQuestion, option: UserQuestionPromptOption): void {
    setSelections((current) => {
      const selected = current[question.id] ?? []
      const next = question.multiSelect
        ? selected.includes(option.id)
          ? selected.filter((id) => id !== option.id)
          : [...selected, option.id]
        : [option.id]

      return { ...current, [question.id]: next }
    })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!canSubmit || submitting) return
    void onSubmit(buildAnswers(prompt.questions, selections, textAnswers))
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={prompt.title}
      maxWidth={680}
      closeOnBackdrop={!submitting}
      closeOnEsc={!submitting}
    >
      <form onSubmit={handleSubmit} className="flex max-h-[70vh] flex-col">
        <div className="min-h-0 overflow-y-auto pr-1">
          <div className="flex flex-col gap-4">
            {prompt.questions.map((question, questionIndex) => (
              <fieldset
                key={question.id}
                className="rounded-card border border-hairline bg-card/60 p-3"
              >
                <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {question.header ?? `Question ${questionIndex + 1}`}
                </legend>
                <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-primary">
                  {question.question}
                </div>

                {question.options.length > 0 ? (
                  <div className="mt-3 flex flex-col gap-2">
                    {question.options.map((option) => {
                      const selected = selections[question.id]?.includes(option.id) ?? false
                      return (
                        <label
                          key={option.id}
                          className={cx(
                            'flex min-w-0 cursor-pointer items-start gap-2 rounded-card border px-3 py-2',
                            'transition-colors',
                            selected
                              ? 'border-accent-primary/50 bg-accent-primary/10'
                              : 'border-hairline bg-card hover:bg-card-raised',
                          )}
                        >
                          <input
                            type={question.multiSelect ? 'checkbox' : 'radio'}
                            name={question.id}
                            checked={selected}
                            disabled={submitting}
                            onChange={() => toggleOption(question, option)}
                            className="mt-1 h-3.5 w-3.5 accent-accent-primary"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-[13px] font-medium leading-5 text-primary">
                              {option.label}
                            </span>
                            {option.description ? (
                              <span className="mt-0.5 block break-words text-xs leading-5 text-secondary">
                                {option.description}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <textarea
                    value={textAnswers[question.id] ?? ''}
                    onChange={(event) =>
                      setTextAnswers((current) => ({
                        ...current,
                        [question.id]: event.target.value,
                      }))
                    }
                    disabled={submitting}
                    className="mt-3 min-h-[92px] w-full resize-y rounded-card border border-hairline bg-bubble-user px-3 py-2 text-sm leading-6 text-primary outline-none placeholder:text-muted focus:border-accent-primary/60"
                    placeholder="Type your answer"
                  />
                )}
              </fieldset>
            ))}
          </div>
        </div>

        {error ? (
          <div className="mt-3 rounded-card border border-accent-del/40 bg-accent-del/10 px-3 py-2 text-xs text-accent-del">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-hairline pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Dismiss
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!canSubmit || submitting}
            leadingIcon={submitting ? <Spinner size={12} /> : undefined}
          >
            Send answers
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function formatUserQuestionPromptAnswers(
  prompt: UserQuestionActivity,
  answers: readonly UserQuestionPromptAnswer[],
): string {
  const lines = ['Answers to your questions:', '']

  for (const answer of answers) {
    if (answer.header) lines.push(`${answer.header}:`)
    lines.push(`Q: ${answer.question}`)

    if (answer.freeText?.trim()) {
      lines.push(`A: ${answer.freeText.trim()}`)
    } else if (answer.selectedLabels.length === 1) {
      lines.push(`A: ${answer.selectedLabels[0]}`)
    } else {
      lines.push('A:')
      answer.selectedLabels.forEach((label) => lines.push(`- ${label}`))
    }

    lines.push('')
  }

  lines.push(`Original prompt id: ${prompt.promptId}`)
  return lines.join('\n').trim()
}

function initialSelections(questions: readonly UserQuestionPromptQuestion[]): SelectionState {
  return Object.fromEntries(questions.map((question) => [question.id, []]))
}

function initialTextAnswers(questions: readonly UserQuestionPromptQuestion[]): TextState {
  return Object.fromEntries(questions.map((question) => [question.id, '']))
}

function questionAnswered(
  question: UserQuestionPromptQuestion,
  selections: SelectionState,
  textAnswers: TextState,
): boolean {
  if (question.options.length === 0) return Boolean(textAnswers[question.id]?.trim())
  return (selections[question.id]?.length ?? 0) > 0
}

function buildAnswers(
  questions: readonly UserQuestionPromptQuestion[],
  selections: SelectionState,
  textAnswers: TextState,
): UserQuestionPromptAnswer[] {
  return questions.map((question) => {
    const selectedOptionIds = selections[question.id] ?? []
    const selectedLabels = selectedOptionIds
      .map((optionId) => question.options.find((option) => option.id === optionId)?.label)
      .filter((label): label is string => Boolean(label))

    return {
      questionId: question.id,
      header: question.header,
      question: question.question,
      selectedOptionIds,
      selectedLabels,
      freeText: question.options.length === 0 ? textAnswers[question.id]?.trim() : undefined,
    }
  })
}
